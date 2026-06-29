import type { Request, Response } from 'express';

import type { BucketRepository, ObjectRepository } from '../../persistence/index';

import { InternalError, NoSuchBucketError, NoSuchKeyError } from '../../s3/errors/s3-error';
import type { BlobStore } from '../../storage/blob-store';
import type { ObjectWriterService } from '../../storage/object-writer.service';
import type { VersionStoreService } from '../../storage/version-store.service';
import type { SseKeyService } from '../../storage/sse-key.service';
import type { XmlSerializer } from '../../s3/xml/xml.serializer';
import { ObjectService } from './object.service';

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
