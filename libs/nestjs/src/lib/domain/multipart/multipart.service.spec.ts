import type { Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ConfigService as NestConfigService } from '@nestjs/config';

import { MultipartUpload } from '../../persistence/index';
import type {
  BucketRepository,
  ObjectRepository,
} from '../../persistence/index';
import { InvalidArgumentError } from '../../s3/errors/s3-error';
import { BlobStore } from '../../storage/blob-store';
import { createSseCipher, generateIv } from '../../storage/sse-cipher';
import type { ObjectWriterService } from '../../storage/object-writer.service';
import type { SseKeyService } from '../../storage/sse-key.service';
import { XmlSerializer } from '../../s3/xml/xml.serializer';
import type { AppConfigService } from '../../common/config/app-config.service';
import { MultipartService } from './multipart.service';

const KEY = Buffer.alloc(32, 5);
const SSE = { key: () => KEY } as unknown as SseKeyService;
const SERIALIZER = new XmlSerializer();

function mkRes(): Response & { _status?: number; _body?: string; _headers: Record<string, string> } {
  const res = {
    _headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this._headers[k.toLowerCase()] = v;
    },
    status(s: number) {
      this._status = s;
      return this;
    },
    send(b: string) {
      this._body = b;
      return this;
    },
  };
  return res as unknown as Response & { _status?: number; _body?: string; _headers: Record<string, string> };
}

function svcWith(overrides: Partial<{
  em: unknown;
  buckets: unknown;
  blobs: unknown;
  objects: unknown;
  config: unknown;
}>): MultipartService {
  return new MultipartService(
    overrides.em as never,
    (overrides.buckets ?? {}) as BucketRepository,
    (overrides.blobs ?? {}) as BlobStore,
    {} as ObjectWriterService,
    (overrides.objects ?? {}) as ObjectRepository,
    SERIALIZER,
    SSE,
    (overrides.config ?? { maxMultipartParts: 10_000 }) as AppConfigService,
  );
}

describe('MultipartService.uploadPart part-cap wiring (TASK-2140)', () => {
  it('rejects a partNumber above the configured MAX_MULTIPART_PARTS', async () => {
    const svc = svcWith({ config: { maxMultipartParts: 100 } });
    const q = { uploadId: 'u', partNumber: '200' };
    await expect(
      svc.uploadPart({ headers: {} } as Request, mkRes(), 'b', 'k', q),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('accepts a partNumber within the configured cap (passes the guard)', async () => {
    // partNumber 100 is within [1,100]; the NoSuchUpload throw proves we got past
    // the argument check to the upload lookup.
    const em = { fork: () => ({ findOne: async () => null }) };
    const svc = svcWith({ config: { maxMultipartParts: 100 }, em });
    await expect(
      svc.uploadPart({ headers: {} } as Request, mkRes(), 'b', 'k', { uploadId: 'u', partNumber: '100' }),
    ).rejects.toThrow(/multipart upload does not exist/);
  });
});

describe('MultipartService.listParts pagination (TASK-2142)', () => {
  // Five parts (numbers 1..5); the fake EM honours { partNumber: { $gt } } + limit.
  const allParts = [1, 2, 3, 4, 5].map((n) => ({
    partNumber: n,
    etag: `e${n}`,
    size: BigInt(n),
    writtenAt: new Date('2026-01-01T00:00:00Z'),
  }));

  const fakeEm = () => ({
    findOne: async (entity: unknown) =>
      entity === MultipartUpload ? { uploadId: 'u' } : null,
    find: async (
      _entity: unknown,
      where: { partNumber?: { $gt?: number } },
      opts: { limit: number },
    ) => {
      const gt = where.partNumber?.$gt ?? 0;
      return allParts.filter((p) => p.partNumber > gt).slice(0, opts.limit);
    },
  });

  const listWith = async (query: Record<string, string>) => {
    const svc = svcWith({ em: { fork: fakeEm } });
    const res = mkRes();
    await svc.listParts({ query } as unknown as Request, res, 'b', 'k', 'u');
    return res._body ?? '';
  };

  it('honours max-parts, sets IsTruncated + NextPartNumberMarker on a truncated page', async () => {
    const body = await listWith({ 'max-parts': '2' });
    expect((body.match(/<Part>/g) ?? []).length).toBe(2);
    expect(body).toContain('<MaxParts>2</MaxParts>');
    expect(body).toContain('<IsTruncated>true</IsTruncated>');
    expect(body).toContain('<NextPartNumberMarker>2</NextPartNumberMarker>');
    expect(body).toContain('<PartNumberMarker>0</PartNumberMarker>');
  });

  it('returns the next page for a supplied part-number-marker', async () => {
    const body = await listWith({ 'max-parts': '2', 'part-number-marker': '2' });
    expect((body.match(/<Part>/g) ?? []).length).toBe(2);
    expect(body).toContain('<PartNumber>3</PartNumber>');
    expect(body).toContain('<PartNumber>4</PartNumber>');
    expect(body).toContain('<NextPartNumberMarker>4</NextPartNumberMarker>');
  });

  it('final page is not truncated and omits NextPartNumberMarker', async () => {
    const body = await listWith({ 'max-parts': '2', 'part-number-marker': '4' });
    expect((body.match(/<Part>/g) ?? []).length).toBe(1);
    expect(body).toContain('<PartNumber>5</PartNumber>');
    expect(body).toContain('<IsTruncated>false</IsTruncated>');
    expect(body).not.toContain('NextPartNumberMarker');
  });

  it('clamps max-parts above 1000 to 1000 in the response', async () => {
    const body = await listWith({ 'max-parts': '999999' });
    expect(body).toContain('<MaxParts>1000</MaxParts>');
  });
});

describe('MultipartService.listMultipartUploads literal-prefix filter (TASK-2162, CWE-150)', () => {
  // Keys whose names look like SQL LIKE wildcards. With the old `$like` filter,
  // prefix `a%` / `a_` would match extra rows; with the byte-wise range scan they
  // must match only literally.
  const seed = ['a%b', 'axb', 'a_c', 'azc'].map((key, i) => ({
    key,
    uploadId: `u${i}`,
    initiator: 'openbucket-root',
    initiatedAt: new Date('2026-01-01T00:00:00Z'),
  }));

  // Fake EM that honours the `{ key: { $gte, $lt } }` range (and rejects `$like`,
  // asserting the service no longer emits it).
  const fakeEm = () => ({
    find: async (
      _entity: unknown,
      where: { key?: { $gte?: string; $lt?: string; $like?: string } },
      _opts: unknown,
    ) => {
      if (where.key && '$like' in where.key) {
        throw new Error('listMultipartUploads must not use $like (TASK-2162)');
      }
      const gte = where.key?.$gte;
      const lt = where.key?.$lt;
      return seed
        .filter((u) => (gte === undefined || u.key >= gte) && (lt === undefined || u.key < lt))
        .sort((a, b) => (a.key < b.key ? -1 : 1));
    },
  });

  const listKeys = async (prefix?: string): Promise<string[]> => {
    const svc = svcWith({ em: fakeEm() });
    const query: Record<string, string> = {};
    if (prefix !== undefined) query['prefix'] = prefix;
    const result = (await svc.listMultipartUploads({ query } as unknown as Request, 'b')) as {
      Upload: Array<{ Key: string }>;
    };
    return result.Upload.map((u) => u.Key);
  };

  it('treats % as a literal, not a wildcard (prefix "a%" → only "a%b")', async () => {
    expect(await listKeys('a%')).toEqual(['a%b']);
  });

  it('treats _ as a literal, not a single-char wildcard (prefix "a_" → only "a_c")', async () => {
    expect(await listKeys('a_')).toEqual(['a_c']);
  });

  it('matches a plain prefix normally (prefix "a" → all four keys)', async () => {
    expect(await listKeys('a')).toEqual(['a%b', 'a_c', 'axb', 'azc']);
  });

  it('an empty prefix returns every upload (no key filter)', async () => {
    expect((await listKeys('')).sort()).toEqual(['a%b', 'a_c', 'axb', 'azc']);
  });
});

describe('MultipartService.uploadPartCopy SSE decrypt (TASK-2130, CWE-325)', () => {
  const stubConfig = (dir: string) => ({ getOrThrow: () => dir }) as unknown as NestConfigService;
  let dataDir: string;
  let blobs: BlobStore;

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', 'openbucket-uploadpartcopy', randomUUID());
    await fs.mkdir(dataDir, { recursive: true });
    blobs = new BlobStore(stubConfig(dataDir));
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const fakeEm = () => ({
    findOne: async (entity: unknown) => (entity === MultipartUpload ? { uploadId: 'u' } : null),
    create: (_e: unknown, data: unknown) => data,
    persist: () => undefined,
    flush: async () => undefined,
  });

  async function copyPart(headers: Record<string, string>, plaintext: Buffer, iv: Buffer): Promise<Buffer> {
    // Stage the source object as ciphertext on disk (as an SSE PutObject would).
    await blobs.putBlob('src', 'k', Readable.from([plaintext]), createSseCipher(KEY, iv));
    const objects = {
      findCurrentVersion: jest.fn().mockResolvedValue({
        size: BigInt(plaintext.length),
        encryption: { algorithm: 'AES256', iv: iv.toString('base64') },
      }),
    } as unknown as ObjectRepository;
    const svc = svcWith({ em: { fork: fakeEm }, blobs, objects });
    const uploadId = 'u';
    await svc.uploadPartCopy(
      { headers: { 'x-amz-copy-source': '/src/k', ...headers } } as unknown as Request,
      mkRes(),
      'dst',
      'k',
      { uploadId, partNumber: '1' },
    );
    return fs.readFile(blobs.paths.multipartPartPath(uploadId, 1));
  }

  it('stages the FULL encrypted source as decrypted plaintext', async () => {
    const plaintext = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789');
    const staged = await copyPart({}, plaintext, generateIv());
    expect(staged.equals(plaintext)).toBe(true);
  });

  it('stages a byte-RANGE of the encrypted source as decrypted plaintext', async () => {
    const plaintext = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789');
    // bytes=2-5 (inclusive) → plaintext[2..5] = 'cdef'.
    const staged = await copyPart({ 'x-amz-copy-source-range': 'bytes=2-5' }, plaintext, generateIv());
    expect(staged.toString()).toBe('cdef');
  });
});
