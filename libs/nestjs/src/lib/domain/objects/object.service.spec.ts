import type { Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';

import type { BucketRepository, ObjectRepository } from '../../persistence/index';

import { InternalError, NoSuchBucketError, NoSuchKeyError } from '../../s3/errors/s3-error';
import { BlobStore } from '../../storage/blob-store';
import { createSseCipher, generateIv } from '../../storage/sse-cipher';
import type { ObjectWriterService } from '../../storage/object-writer.service';
import type { VersionStoreService } from '../../storage/version-store.service';
import type { SseKeyService } from '../../storage/sse-key.service';
import type { XmlSerializer } from '../../s3/xml/xml.serializer';
import {
  ObjectService,
  applySafeObjectResponseHeaders,
  isActiveContentType,
} from './object.service';

const REPO = {} as ObjectRepository;
const BLOBS = {} as BlobStore;
const VERSIONS = {} as VersionStoreService;
const SERIALIZER = {} as XmlSerializer;
const SSE = { key: () => Buffer.alloc(32) } as unknown as SseKeyService;

/**
 * TEST-0303 — PutObject handler unit. The full streaming round-trip is covered
 * by the PutObject e2e (TEST-0304); these assert the handler's branches with a
 * mocked writer + bucket repository.
 */
const ctx = {
  stream: {} as NodeJS.ReadableStream,
  hashes: Promise.resolve({ md5Hex: '', md5Base64: '', sha256Hex: '' }),
  size: Promise.resolve(0),
};

function mkReq(headers: Record<string, string>, putCtx?: unknown): Request {
  return { headers, openbucketPutCtx: putCtx } as unknown as Request;
}
function mkRes(): Response & { _status?: number; _headers: Record<string, string> } {
  const res = {
    _headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this._headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return this._headers[k.toLowerCase()];
    },
    status(s: number) {
      this._status = s;
      return this;
    },
    end() {
      return this;
    },
  };
  return res as unknown as Response & { _status?: number; _headers: Record<string, string> };
}

describe('ObjectService.putObject (TEST-0303)', () => {
  it('throws InternalError when the interceptor context is absent', async () => {
    const svc = new ObjectService({} as ObjectWriterService, {} as BucketRepository, REPO, BLOBS, VERSIONS, SERIALIZER, SSE);
    await expect(svc.putObject(mkReq({}), mkRes(), 'b', 'k')).rejects.toBeInstanceOf(InternalError);
  });

  it('throws NoSuchBucket when the bucket does not exist', async () => {
    const buckets = { exists: jest.fn().mockResolvedValue(false) } as unknown as BucketRepository;
    const svc = new ObjectService({} as ObjectWriterService, buckets, REPO, BLOBS, VERSIONS, SERIALIZER, SSE);
    await expect(svc.putObject(mkReq({}, ctx), mkRes(), 'b', 'k')).rejects.toBeInstanceOf(
      NoSuchBucketError,
    );
  });

  it('writes via ObjectWriter, sets the ETag header, and returns undefined', async () => {
    const buckets = { exists: jest.fn().mockResolvedValue(true) } as unknown as BucketRepository;
    const writer = {
      put: jest.fn().mockResolvedValue({ etag: 'abc123', currentVersionId: undefined }),
    } as unknown as ObjectWriterService;
    const svc = new ObjectService(writer, buckets, REPO, BLOBS, VERSIONS, SERIALIZER, SSE);
    const res = mkRes();

    const out = await svc.putObject(
      mkReq({ 'content-type': 'text/plain', 'x-amz-meta-foo': 'bar' }, ctx),
      res,
      'b',
      'k',
    );

    expect(out).toBeUndefined();
    expect(res._headers['etag']).toBe('"abc123"');
    expect(res._status).toBe(200);
    expect(writer.put).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'b',
        key: 'k',
        contentType: 'text/plain',
        userMetadata: { foo: 'bar' },
      }),
    );
  });
});

describe('ObjectService.getObject (TEST-0305)', () => {
  it('throws NoSuchKey when the object pointer is absent', async () => {
    const repo = {
      findCurrentVersion: jest.fn().mockResolvedValue(null),
    } as unknown as ObjectRepository;
    const svc = new ObjectService({} as ObjectWriterService, {} as BucketRepository, repo, BLOBS, VERSIONS, SERIALIZER, SSE);
    await expect(svc.getObject(mkReq({}), mkRes(), 'b', 'k')).rejects.toBeInstanceOf(NoSuchKeyError);
  });

  it('returns 416 with Content-Range for an unsatisfiable Range', async () => {
    const obj = {
      size: 100n,
      etag: 'e',
      contentType: 'text/plain',
      modifiedAt: new Date(),
      currentVersionId: undefined,
    };
    const repo = {
      findCurrentVersion: jest.fn().mockResolvedValue(obj),
    } as unknown as ObjectRepository;
    const svc = new ObjectService({} as ObjectWriterService, {} as BucketRepository, repo, BLOBS, VERSIONS, SERIALIZER, SSE);
    const res = mkRes();

    const out = await svc.getObject(mkReq({ range: 'bytes=200-300' }), res, 'b', 'k');

    expect(out).toBeUndefined();
    expect(res._status).toBe(416);
    expect(res._headers['content-range']).toBe('bytes */100');
  });
});

describe('safe object-response headers (TASK-2110, CWE-79)', () => {
  it('isActiveContentType flags HTML/XHTML/SVG (params + case ignored), not images/text', () => {
    expect(isActiveContentType('text/html')).toBe(true);
    expect(isActiveContentType('text/HTML; charset=utf-8')).toBe(true);
    expect(isActiveContentType('application/xhtml+xml')).toBe(true);
    expect(isActiveContentType('image/svg+xml')).toBe(true);
    expect(isActiveContentType('image/png')).toBe(false);
    expect(isActiveContentType('text/plain')).toBe(false);
    expect(isActiveContentType('application/octet-stream')).toBe(false);
  });

  it('applySafeObjectResponseHeaders neutralizes text/html → octet-stream + attachment + CSP + nosniff', () => {
    const res = mkRes();
    const emitted = applySafeObjectResponseHeaders(res, 'text/html');
    expect(emitted).toBe('application/octet-stream');
    expect(res._headers['content-disposition']).toBe('attachment');
    expect(res._headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res._headers['x-content-type-options']).toBe('nosniff');
  });

  it('applySafeObjectResponseHeaders keeps a safe Content-Type inline but still sets CSP + nosniff', () => {
    const res = mkRes();
    const emitted = applySafeObjectResponseHeaders(res, 'image/png');
    expect(emitted).toBe('image/png');
    expect(res._headers['content-disposition']).toBeUndefined();
    expect(res._headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res._headers['x-content-type-options']).toBe('nosniff');
  });

  it('applySafeObjectResponseHeaders preserves a pre-set attachment filename disposition', () => {
    const res = mkRes();
    res.setHeader('Content-Disposition', 'attachment; filename="evil.html"');
    applySafeObjectResponseHeaders(res, 'text/html');
    expect(res._headers['content-disposition']).toBe('attachment; filename="evil.html"');
  });
});

describe('ObjectService.copyObject SSE decrypt (TASK-2130, CWE-325)', () => {
  const KEY = Buffer.alloc(32, 7);
  const SSE_KEY = { key: () => KEY } as unknown as SseKeyService;
  const stubConfig = (dir: string) => ({ getOrThrow: () => dir }) as unknown as ConfigService;

  let dataDir: string;
  let store: BlobStore;

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', 'openbucket-copy-decrypt', randomUUID());
    await fs.mkdir(dataDir, { recursive: true });
    store = new BlobStore(stubConfig(dataDir));
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  /** Run copyObject against a staged source, capturing the bytes handed to the writer. */
  async function runCopy(src: {
    plaintext: Buffer;
    encryption?: { algorithm: 'AES256'; iv: string };
  }): Promise<Buffer> {
    const buckets = { exists: jest.fn().mockResolvedValue(true) } as unknown as BucketRepository;
    const objects = {
      findCurrentVersion: jest.fn().mockResolvedValue({
        etag: 'srcetag',
        contentType: 'text/plain',
        userMetadata: undefined,
        encryption: src.encryption,
        size: BigInt(src.plaintext.length),
      }),
    } as unknown as ObjectRepository;

    let captured = Buffer.alloc(0);
    const writer = {
      put: jest.fn(async (cmd: { body: Readable }) => {
        const chunks: Buffer[] = [];
        for await (const c of cmd.body) chunks.push(c as Buffer);
        captured = Buffer.concat(chunks);
        return { etag: 'dst', modifiedAt: new Date() };
      }),
    } as unknown as ObjectWriterService;

    const svc = new ObjectService(writer, buckets, objects, store, VERSIONS, SERIALIZER, SSE_KEY);
    const req = mkReq({ 'x-amz-copy-source': '/src/k' });
    await svc.copyObject(req, mkRes(), 'dst', 'k');
    return captured;
  }

  it('decrypts an SSE-encrypted source so the writer receives PLAINTEXT (not ciphertext)', async () => {
    const plaintext = Buffer.from('the quick brown fox — encrypted at rest'.repeat(4));
    const iv = generateIv();
    // Stage the source as ciphertext on disk, exactly as an SSE PutObject would.
    await store.putBlob('src', 'k', Readable.from([plaintext]), createSseCipher(KEY, iv));

    const captured = await runCopy({ plaintext, encryption: { algorithm: 'AES256', iv: iv.toString('base64') } });
    expect(captured.equals(plaintext)).toBe(true);
  });

  it('passes an unencrypted source through unchanged', async () => {
    const plaintext = Buffer.from('plain source bytes');
    await store.putBlob('src', 'k', Readable.from([plaintext]));

    const captured = await runCopy({ plaintext });
    expect(captured.equals(plaintext)).toBe(true);
  });
});

describe('ObjectService.headObject safe headers (TASK-2110)', () => {
  const makeSvc = (obj: unknown) => {
    const repo = {
      findCurrentVersion: jest.fn().mockResolvedValue(obj),
    } as unknown as ObjectRepository;
    return new ObjectService(
      {} as ObjectWriterService,
      {} as BucketRepository,
      repo,
      BLOBS,
      VERSIONS,
      SERIALIZER,
      SSE,
    );
  };
  const baseObj = {
    etag: 'e',
    modifiedAt: new Date('2026-01-01T00:00:00Z'),
    size: 10n,
    userMetadata: {},
    currentVersionId: undefined,
  };

  it('HEAD on a text/html object → attachment + octet-stream + CSP + nosniff', async () => {
    const svc = makeSvc({ ...baseObj, contentType: 'text/html' });
    const res = mkRes();
    await svc.headObject(mkReq({}), res, 'b', 'k');
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toBe('application/octet-stream');
    expect(res._headers['content-disposition']).toBe('attachment');
    expect(res._headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res._headers['x-content-type-options']).toBe('nosniff');
  });

  it('HEAD on an image/png object → inline Content-Type retained, still CSP + nosniff', async () => {
    const svc = makeSvc({ ...baseObj, contentType: 'image/png' });
    const res = mkRes();
    await svc.headObject(mkReq({}), res, 'b', 'k');
    expect(res._headers['content-type']).toBe('image/png');
    expect(res._headers['content-disposition']).toBeUndefined();
    expect(res._headers['content-security-policy']).toBe("default-src 'none'; sandbox");
  });

  // --- x-amz-storage-class (STORY-0901, TASK-2714) ---
  it('HEAD of a tiered (GLACIER) object emits x-amz-storage-class', async () => {
    const svc = makeSvc({ ...baseObj, contentType: 'text/plain', storageClass: 'GLACIER' });
    const res = mkRes();
    await svc.headObject(mkReq({}), res, 'b', 'k');
    expect(res._headers['x-amz-storage-class']).toBe('GLACIER');
  });

  it('HEAD of a STANDARD object omits x-amz-storage-class (S3 parity)', async () => {
    const svc = makeSvc({ ...baseObj, contentType: 'text/plain', storageClass: 'STANDARD' });
    const res = mkRes();
    await svc.headObject(mkReq({}), res, 'b', 'k');
    expect(res._headers['x-amz-storage-class']).toBeUndefined();
  });
});

// --- deleteOne object.deleted events (STORY-0801) ---
describe('ObjectService.deleteOne events (STORY-0801)', () => {
  interface Emitted {
    emitInProcess: jest.Mock;
    enqueueInTx: jest.Mock;
  }
  const mkEvents = (): Emitted => ({ emitInProcess: jest.fn(), enqueueInTx: jest.fn() });

  it('unversioned delete of an existing key emits one object.deleted (no versionId) + enqueues in-tx', async () => {
    const events = mkEvents();
    const row = { softDeleted: false, modifiedAt: new Date('2026-07-02T00:00:00.000Z'), lock: undefined };
    const em = {
      begin: jest.fn(),
      findOne: jest.fn().mockResolvedValue(row),
      persist: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn(),
    };
    const objects = { getEntityManager: () => ({ fork: () => em }) } as unknown as ObjectRepository;
    const buckets = { hasVersionHistory: jest.fn().mockResolvedValue(false) } as unknown as BucketRepository;
    const blobs = { deleteBlob: jest.fn().mockResolvedValue(undefined) } as unknown as BlobStore;
    const svc = new ObjectService({} as ObjectWriterService, buckets, objects, blobs, VERSIONS, SERIALIZER, SSE, events as never);

    await svc.deleteOne('b', 'k');

    // enqueue happened before commit (in-tx), emit after commit.
    expect(events.enqueueInTx).toHaveBeenCalledTimes(1);
    expect(em.commit).toHaveBeenCalledTimes(1);
    expect(events.emitInProcess).toHaveBeenCalledTimes(1);
    expect(events.emitInProcess.mock.calls[0][0]).toMatchObject({
      type: 'object.deleted',
      bucket: 'b',
      key: 'k',
      size: 0,
      etag: '',
    });
    expect(events.emitInProcess.mock.calls[0][0].versionId).toBeUndefined();
  });

  it('unversioned delete of an absent key emits nothing (idempotent no-op)', async () => {
    const events = mkEvents();
    const em = {
      begin: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn(),
    };
    const objects = { getEntityManager: () => ({ fork: () => em }) } as unknown as ObjectRepository;
    const buckets = { hasVersionHistory: jest.fn().mockResolvedValue(false) } as unknown as BucketRepository;
    const svc = new ObjectService({} as ObjectWriterService, buckets, objects, BLOBS, VERSIONS, SERIALIZER, SSE, events as never);

    const result = await svc.deleteOne('b', 'missing');

    expect(result).toEqual({});
    expect(events.enqueueInTx).not.toHaveBeenCalled();
    expect(events.emitInProcess).not.toHaveBeenCalled();
  });

  it('versioned delete emits object.deleted carrying the marker versionId + enqueues in the marker tx', async () => {
    const events = mkEvents();
    const marker = { versionId: 'marker-v7' };
    const fakeEm = {} as never;
    const versions = {
      writeDeleteMarker: jest.fn().mockImplementation(async (_b, _k, cb?: (em: unknown, m: unknown) => void) => {
        cb?.(fakeEm, marker); // runs the in-tx enqueue hook
        return marker;
      }),
    } as unknown as VersionStoreService;
    const objects = { findCurrentVersion: jest.fn().mockResolvedValue({ versionId: 'cur' }) } as unknown as ObjectRepository;
    const buckets = { hasVersionHistory: jest.fn().mockResolvedValue(true) } as unknown as BucketRepository;
    const svc = new ObjectService({} as ObjectWriterService, buckets, objects, BLOBS, versions, SERIALIZER, SSE, events as never);

    const result = await svc.deleteOne('bv', 'k');

    expect(result).toEqual({ deleteMarker: true, versionId: 'marker-v7' });
    expect(events.enqueueInTx).toHaveBeenCalledWith(fakeEm, expect.objectContaining({
      type: 'object.deleted',
      versionId: 'marker-v7',
      size: 0,
      etag: '',
    }));
    expect(events.emitInProcess).toHaveBeenCalledTimes(1);
    expect(events.emitInProcess.mock.calls[0][0]).toMatchObject({ type: 'object.deleted', versionId: 'marker-v7' });
  });

  it('versioned delete of an already-hidden key emits nothing', async () => {
    const events = mkEvents();
    const versions = { writeDeleteMarker: jest.fn() } as unknown as VersionStoreService;
    const objects = { findCurrentVersion: jest.fn().mockResolvedValue(null) } as unknown as ObjectRepository;
    const buckets = { hasVersionHistory: jest.fn().mockResolvedValue(true) } as unknown as BucketRepository;
    const svc = new ObjectService({} as ObjectWriterService, buckets, objects, BLOBS, versions, SERIALIZER, SSE, events as never);

    const result = await svc.deleteOne('bv', 'gone');

    expect(result).toEqual({});
    expect(versions.writeDeleteMarker).not.toHaveBeenCalled();
    expect(events.emitInProcess).not.toHaveBeenCalled();
  });
});
