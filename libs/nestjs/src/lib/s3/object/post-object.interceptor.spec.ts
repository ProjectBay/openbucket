import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { lastValueFrom, of } from 'rxjs';

import type { AppConfigService } from '../../common/config/app-config.service';
import type { AccessKey, KeyService } from '../sigv4/key.service';
import {
  EntityTooLargeError,
  MalformedPOSTRequestError,
  SignatureDoesNotMatchError,
} from '../errors/s3-error';
import { buildPresignedPost, type PresignPostInput } from '../sigv4/presigned-post';
import { PostObjectInterceptor } from './post-object.interceptor';

/**
 * TEST-0802 — PostObjectInterceptor unit. `maxObjectSizeMb = 1` so the 1 MiB cap
 * is easy to exceed; the KeyService stub resolves the one known access key.
 */
const AKID = 'AKIAEXAMPLE000000000';
const SECRET = 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s';
const CONFIG = { maxObjectSizeMb: 1 } as AppConfigService;

const keys: KeyService = {
  getSecret: async (id: string): Promise<AccessKey | null> =>
    id === AKID ? { accessKeyId: AKID, secretAccessKey: SECRET, disabled: false } : null,
};

const MINT: PresignPostInput = {
  accessKeyId: AKID,
  secretAccessKey: SECRET,
  region: 'us-east-1',
  scheme: 'https',
  host: 'files.example.com',
  bucket: 'b',
  key: 'u/${filename}',
  expiresIn: 900,
  now: new Date(),
};

function execCtx(req: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function buildMultipart(
  fields: Record<string, string>,
  files: Array<{ name: string; filename: string; contentType: string; data: Buffer }>,
): { body: Buffer; contentType: string } {
  const boundary = '----obtest' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.contentType}\r\n\r\n`,
      ),
    );
    parts.push(f.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Drive the interceptor over a prepared multipart body. */
function run(
  fields: Record<string, string>,
  files: Array<{ name: string; filename: string; contentType: string; data: Buffer }>,
): { req: IncomingMessage; result: Promise<unknown> } {
  const { body, contentType } = buildMultipart(fields, files);
  const req = Readable.from([body]) as unknown as IncomingMessage;
  (req as unknown as { method: string }).method = 'POST';
  (req as unknown as { headers: unknown }).headers = { 'content-type': contentType };
  (req as unknown as { openbucket: unknown }).openbucket = { s3Scope: 's3-bucket', bucket: 'b' };
  (req as unknown as { query: unknown }).query = {};

  const next: CallHandler = {
    handle: () => {
      // Drain the verified stream so the verifier's hashes/size settle.
      req.openbucketPutCtx?.stream.resume();
      return of('handled');
    },
  };
  const interceptor = new PostObjectInterceptor(CONFIG, keys);
  const result = lastValueFrom(interceptor.intercept(execCtx(req), next));
  return { req, result };
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('PostObjectInterceptor (TEST-0802)', () => {
  it('streams a valid upload to openbucketPutCtx + stamps openbucketPost', async () => {
    const data = Buffer.from('hello browser upload');
    const { fields } = buildPresignedPost(MINT);
    const { req, result } = run(fields, [
      { name: 'file', filename: 'photo.png', contentType: 'image/png', data },
    ]);

    await expect(result).resolves.toBe('handled');
    expect(req.openbucketPost).toMatchObject({
      bucket: 'b',
      key: 'u/photo.png',
      accessKeyId: AKID,
      contentType: 'image/png',
    });
    await expect(req.openbucketPutCtx!.size).resolves.toBe(data.length);
    await expect(req.openbucketPutCtx!.hashes).resolves.toMatchObject({
      sha256Hex: expect.any(String),
    });
  });

  it('rejects a tampered signature with SignatureDoesNotMatch', async () => {
    const { fields } = buildPresignedPost(MINT);
    fields['x-amz-signature'] = fields['x-amz-signature'].replace(/.$/, (c) =>
      c === '0' ? '1' : '0',
    );
    const { result } = run(fields, [
      { name: 'file', filename: 'photo.png', contentType: 'image/png', data: Buffer.from('x') },
    ]);
    await expect(result).rejects.toBeInstanceOf(SignatureDoesNotMatchError);
  });

  it('rejects a wrong/unknown access key with SignatureDoesNotMatch (no key leak)', async () => {
    const { fields } = buildPresignedPost({ ...MINT, accessKeyId: 'AKIAUNKNOWN000000000' });
    const { result } = run(fields, [
      { name: 'file', filename: 'photo.png', contentType: 'image/png', data: Buffer.from('x') },
    ]);
    await expect(result).rejects.toBeInstanceOf(SignatureDoesNotMatchError);
  });

  it('destroys the stream with EntityTooLarge when the file exceeds the range', async () => {
    const { fields } = buildPresignedPost({
      ...MINT,
      extraConditions: [['content-length-range', 0, 10]],
    });
    const { req, result } = run(fields, [
      { name: 'file', filename: 'photo.png', contentType: 'image/png', data: Buffer.alloc(11, 0x61) },
    ]);
    await expect(result).resolves.toBe('handled');
    await expect(req.openbucketPutCtx!.hashes).rejects.toBeInstanceOf(EntityTooLargeError);
  });

  it('rejects a second file part with MalformedPOSTRequest (files limit, CWE-770)', async () => {
    const { fields } = buildPresignedPost(MINT);
    const { req, result } = run(fields, [
      { name: 'file', filename: 'a.png', contentType: 'image/png', data: Buffer.from('first') },
      { name: 'file', filename: 'b.png', contentType: 'image/png', data: Buffer.from('second') },
    ]);
    // busboy's files:1 limit trips on the second file part and the whole request
    // is rejected — a second file can never be read into storage.
    await expect(result).rejects.toBeInstanceOf(MalformedPOSTRequestError);
    req.openbucketPutCtx?.hashes.catch(() => undefined);
    await delay(20);
  });

  it('passes non-multipart / wrong-scope requests through untouched', async () => {
    const req = Readable.from([Buffer.from('x')]) as unknown as IncomingMessage;
    (req as unknown as { headers: unknown }).headers = { 'content-type': 'application/xml' };
    (req as unknown as { openbucket: unknown }).openbucket = { s3Scope: 's3-bucket', bucket: 'b' };
    (req as unknown as { query: unknown }).query = {};
    const next: CallHandler = { handle: () => of('passthrough') };
    const interceptor = new PostObjectInterceptor(CONFIG, keys);
    await expect(lastValueFrom(interceptor.intercept(execCtx(req), next))).resolves.toBe(
      'passthrough',
    );
    expect(req.openbucketPutCtx).toBeUndefined();
  });
});
