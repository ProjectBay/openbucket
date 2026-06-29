import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { lastValueFrom, of } from 'rxjs';

import type { AppConfigService } from '../../common/config/app-config.service';
import {
  BadDigestError,
  EntityTooLargeError,
  IncompleteBodyError,
  InvalidArgumentError,
  InvalidRequestError,
  XAmzContentSHA256MismatchError,
} from '../errors/s3-error';
import { ChunkSigningContext, expectedChunkSignature } from '../sigv4/chunk-signing';
import { PutObjectInterceptor, PutObjectStreamContext } from './put-object.interceptor';

/**
 * TEST-0301 — PutObjectInterceptor unit. `maxObjectSizeMb = 1` so the 1 MiB
 * cap is easy to exceed.
 */
const interceptor = new PutObjectInterceptor({ maxObjectSizeMb: 1 } as AppConfigService);

function execCtx(req: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}
const NEXT: CallHandler = { handle: () => of(undefined) };

/** Run the interceptor over a fixed body and drain the verifier. */
function runBody(body: Buffer, headers: Record<string, string>): PutObjectStreamContext {
  const req = Readable.from([body]) as unknown as IncomingMessage;
  (req as unknown as { headers: unknown }).headers = headers;
  interceptor.intercept(execCtx(req), NEXT);
  const ctx = req.openbucketPutCtx as PutObjectStreamContext;
  ctx.stream.on('error', () => undefined); // promises carry the failure
  // Mark both promises handled so a test that asserts only one doesn't leave
  // the other as an unhandled rejection.
  ctx.hashes.catch(() => undefined);
  ctx.size.catch(() => undefined);
  ctx.stream.resume();
  return ctx;
}

describe('PutObjectInterceptor (TEST-0301)', () => {
  it('case 1: settles hashes + size for a body with matching MD5 and SHA-256', async () => {
    const body = Buffer.alloc(256, 0x61);
    const md5Hex = createHash('md5').update(body).digest('hex');
    const md5Base64 = Buffer.from(md5Hex, 'hex').toString('base64');
    const sha256Hex = createHash('sha256').update(body).digest('hex');

    const ctx = runBody(body, { 'x-amz-content-sha256': sha256Hex, 'content-md5': md5Base64 });

    await expect(ctx.hashes).resolves.toEqual({ md5Hex, md5Base64, sha256Hex });
    await expect(ctx.size).resolves.toBe(256);
  });

  it('case 2: body over the cap rejects with EntityTooLarge', async () => {
    const ctx = runBody(Buffer.alloc(1024 * 1024 + 1), { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' });
    await expect(ctx.hashes).rejects.toBeInstanceOf(EntityTooLargeError);
  });

  it('case 3: Content-MD5 mismatch rejects with BadDigest', async () => {
    const ctx = runBody(Buffer.from('hello'), {
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'content-md5': Buffer.alloc(16).toString('base64'),
    });
    await expect(ctx.hashes).rejects.toBeInstanceOf(BadDigestError);
  });

  it('case 4: x-amz-content-sha256 hex mismatch rejects with XAmzContentSHA256Mismatch', async () => {
    const ctx = runBody(Buffer.from('hello'), { 'x-amz-content-sha256': 'de' + '0'.repeat(62) });
    await expect(ctx.hashes).rejects.toBeInstanceOf(XAmzContentSHA256MismatchError);
  });

  it('case 5: UNSIGNED-PAYLOAD skips the SHA-256 check', async () => {
    const ctx = runBody(Buffer.from('hello'), { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' });
    await expect(ctx.hashes).resolves.toMatchObject({ sha256Hex: expect.any(String) });
    await expect(ctx.size).resolves.toBe(5);
  });

  it('case 6: STREAMING without a chunk-signing context throws InvalidArgument', async () => {
    // No req.openbucket.chunkSigning (e.g. a presigned streaming PUT) → we can't
    // verify the chunk chain, so reject (STORY-0119).
    const req = Readable.from([Buffer.from('x')]) as unknown as IncomingMessage;
    (req as unknown as { headers: unknown }).headers = {
      'x-amz-content-sha256': 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD',
    };
    const obs = interceptor.intercept(execCtx(req), { handle: () => of('ok') } as CallHandler);
    await expect(lastValueFrom(obs)).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('case 6b: STREAMING with a valid chunk-signing context decodes the body', async () => {
    const body = Buffer.from('hello chunked world, this is the decoded payload');
    const chunkCtx: ChunkSigningContext = {
      signingKey: createHash('sha256').update('signing-key').digest(),
      seedSignature: 'a'.repeat(64),
      amzDate: '20260624T000000Z',
      credentialScope: '20260624/us-east-1/s3/aws4_request',
    };
    const frame = (data: Buffer, prev: string): { buf: Buffer; sig: string } => {
      const sig = expectedChunkSignature({
        signingKey: chunkCtx.signingKey,
        amzDate: chunkCtx.amzDate,
        credentialScope: chunkCtx.credentialScope,
        previousSignature: prev,
        chunkSha256Hex: createHash('sha256').update(data).digest('hex'),
      });
      const buf = Buffer.concat([
        Buffer.from(`${data.length.toString(16)};chunk-signature=${sig}\r\n`, 'latin1'),
        data,
        Buffer.from('\r\n', 'latin1'),
      ]);
      return { buf, sig };
    };
    const c1 = frame(body, chunkCtx.seedSignature);
    const cFinal = frame(Buffer.alloc(0), c1.sig);
    const encoded = Buffer.concat([c1.buf, cFinal.buf]);

    const req = Readable.from([encoded]) as unknown as IncomingMessage;
    (req as unknown as { headers: unknown }).headers = {
      'x-amz-content-sha256': 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD',
      'x-amz-decoded-content-length': String(body.length),
    };
    (req as unknown as { openbucket: unknown }).openbucket = { chunkSigning: chunkCtx };

    interceptor.intercept(execCtx(req), NEXT);
    const ctx = req.openbucketPutCtx as PutObjectStreamContext;
    const out: Buffer[] = [];
    ctx.stream.on('data', (c: Buffer) => out.push(c));

    await expect(ctx.size).resolves.toBe(body.length);
    await expect(ctx.hashes).resolves.toMatchObject({
      md5Hex: createHash('md5').update(body).digest('hex'),
      sha256Hex: createHash('sha256').update(body).digest('hex'),
    });
    expect(Buffer.concat(out).equals(body)).toBe(true);
  });

  it('case 7: missing x-amz-content-sha256 throws InvalidRequest', async () => {
    const req = Readable.from([Buffer.from('x')]) as unknown as IncomingMessage;
    (req as unknown as { headers: unknown }).headers = {};
    const obs = interceptor.intercept(execCtx(req), { handle: () => of('ok') } as CallHandler);
    await expect(lastValueFrom(obs)).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it('case 8: client abort rejects both promises and destroys the verifier', async () => {
    const req = new PassThrough() as unknown as IncomingMessage;
    (req as unknown as { headers: unknown }).headers = { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' };
    interceptor.intercept(execCtx(req), NEXT);
    const ctx = req.openbucketPutCtx as PutObjectStreamContext;
    ctx.stream.on('error', () => undefined);
    ctx.stream.resume();
    (req as unknown as PassThrough).write(Buffer.from('partial'));
    (req as unknown as PassThrough).emit('aborted');

    await expect(ctx.hashes).rejects.toBeInstanceOf(IncompleteBodyError);
    await expect(ctx.size).rejects.toBeInstanceOf(IncompleteBodyError);
    expect((ctx.stream as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });

  it('case 9: a request error rejects both promises with that error', async () => {
    const req = new PassThrough() as unknown as IncomingMessage;
    (req as unknown as { headers: unknown }).headers = { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' };
    interceptor.intercept(execCtx(req), NEXT);
    const ctx = req.openbucketPutCtx as PutObjectStreamContext;
    ctx.stream.on('error', () => undefined);
    ctx.stream.resume();
    const boom = new Error('socket hang up');
    (req as unknown as PassThrough).emit('error', boom);

    await expect(ctx.hashes).rejects.toBe(boom);
    await expect(ctx.size).rejects.toBe(boom);
  });
});
