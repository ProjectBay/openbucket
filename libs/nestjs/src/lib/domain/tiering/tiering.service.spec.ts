import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';

import type { AppConfigService } from '../../common/config/app-config.service';
import type { Clock } from '../../common/clock/clock';
import type { BlobStore } from '../../storage/blob-store';
import type { FreeSpaceService } from '../../storage/free-space.service';
import type { SseKeyService } from '../../storage/sse-key.service';
import type { RemoteObjectStore } from '../../storage/replication/remote-object-store';
import { InternalError, SlowDownError } from '../../s3/errors/s3-error';
import { ObjectLocation, StorageClass } from '../../persistence/index';
import { TieringService } from './tiering.service';

/**
 * TEST-0901 — TieringService: durable offload (tierToRemote), read-through
 * rehydration + single-flight + integrity gate, presign redirect, and the
 * no-remote no-op. The EntityManager, BlobStore, and RemoteObjectStore are mocked.
 */
const NOW = Date.parse('2026-07-05T00:00:00.000Z');
const SHA = 'a'.repeat(64);

function stub(over: Record<string, unknown> = {}) {
  return {
    bucket: { name: 'b' },
    key: 'k',
    size: 5n,
    etag: 'e',
    contentSha256: SHA,
    contentType: 'text/plain',
    location: ObjectLocation.Remote,
    remoteKey: 'k',
    storageClass: StorageClass.Glacier,
    ...over,
  };
}

function makeEm(obj: unknown) {
  const tem = { findOne: jest.fn().mockResolvedValue(obj), persist: jest.fn() };
  const forkEm = {
    findOne: jest.fn().mockResolvedValue(obj),
    transactional: jest.fn(async (cb: (em: unknown) => Promise<void>) => cb(tem)),
  };
  const em = {
    fork: jest.fn(() => forkEm),
    transactional: jest.fn(async (cb: (em: unknown) => Promise<void>) => cb(tem)),
  } as unknown as EntityManager;
  return { em, forkEm, tem };
}

const SSE = { key: () => Buffer.alloc(32) } as unknown as SseKeyService;
const CLOCK = { nowMs: () => NOW, now: () => new Date(NOW) } as unknown as Clock;

function makeConfig(over: Partial<Record<string, number>> = {}) {
  return {
    tierInlineMaxBytes: 256 * 1024 * 1024,
    tierReadThroughTimeoutMs: 30_000,
    tierMaxConcurrentRehydrate: 8,
    tierPresignTtlSeconds: 300,
    ...over,
  } as unknown as AppConfigService;
}

describe('TieringService (TEST-0901)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('remoteEnabled / no-remote no-op', () => {
    it('reports disabled and skips tierToRemote when no remote is wired', async () => {
      const { em } = makeEm(stub());
      const svc = new TieringService(em, {} as BlobStore, SSE, makeConfig(), CLOCK);
      expect(svc.remoteEnabled).toBe(false);
      const out = await svc.tierToRemote({ em, bucket: 'b', key: 'k', storageClass: StorageClass.Glacier });
      expect(out).toBe('skipped');
    });
  });

  describe('tierToRemote', () => {
    it('offloads a local object: uploads, verifies size, flips to stub, soft-deletes blob', async () => {
      const obj = stub({ location: ObjectLocation.Local, remoteKey: undefined, encryption: undefined });
      const { em, tem } = makeEm(obj);
      const blobs = {
        getBlob: jest.fn().mockResolvedValue({ stream: { destroy: jest.fn() } }),
        deleteBlob: jest.fn().mockResolvedValue(undefined),
      } as unknown as BlobStore;
      const remote = {
        enabled: true,
        put: jest.fn().mockResolvedValue(undefined),
        head: jest.fn().mockResolvedValue({ contentLength: 5 }),
      } as unknown as RemoteObjectStore;
      const svc = new TieringService(em, blobs, SSE, makeConfig(), CLOCK, remote);

      const out = await svc.tierToRemote({ em, bucket: 'b', key: 'k', storageClass: StorageClass.Glacier });

      expect(out).toBe('tiered');
      expect(remote.put).toHaveBeenCalledWith('b', 'k', expect.anything(), expect.objectContaining({ contentLength: 5 }));
      expect(blobs.deleteBlob).toHaveBeenCalledWith('b', 'k');
      const row = await (tem.findOne as jest.Mock).mock.results[0].value;
      expect(row.location).toBe(ObjectLocation.Remote);
      expect(row.remoteKey).toBe('k');
      expect(row.storageClass).toBe(StorageClass.Glacier);
    });

    it('leaves the object LOCAL and never deletes the blob on a remote size mismatch', async () => {
      const obj = stub({ location: ObjectLocation.Local, remoteKey: undefined, encryption: undefined });
      const { em } = makeEm(obj);
      const blobs = {
        getBlob: jest.fn().mockResolvedValue({ stream: { destroy: jest.fn() } }),
        deleteBlob: jest.fn().mockResolvedValue(undefined),
      } as unknown as BlobStore;
      const remote = {
        enabled: true,
        put: jest.fn().mockResolvedValue(undefined),
        head: jest.fn().mockResolvedValue({ contentLength: 4 }), // short upload
      } as unknown as RemoteObjectStore;
      const svc = new TieringService(em, blobs, SSE, makeConfig(), CLOCK, remote);

      await expect(
        svc.tierToRemote({ em, bucket: 'b', key: 'k', storageClass: StorageClass.Glacier }),
      ).rejects.toThrow();
      expect(blobs.deleteBlob).not.toHaveBeenCalled();
    });

    it('skips a row that is not LOCAL (already tiered)', async () => {
      const { em } = makeEm(stub({ location: ObjectLocation.Remote }));
      const remote = { enabled: true, put: jest.fn(), head: jest.fn() } as unknown as RemoteObjectStore;
      const svc = new TieringService(em, {} as BlobStore, SSE, makeConfig(), CLOCK, remote);
      const out = await svc.tierToRemote({ em, bucket: 'b', key: 'k', storageClass: StorageClass.Glacier });
      expect(out).toBe('skipped');
      expect(remote.put).not.toHaveBeenCalled();
    });
  });

  describe('rehydrate', () => {
    function setup(over: Record<string, unknown> = {}, sha = SHA) {
      const obj = stub(over);
      const { em, tem } = makeEm(obj);
      const blobs = {
        putBlob: jest.fn().mockResolvedValue({ sha256: sha, size: 5n, etag: 'e', finalPath: '/p' }),
        deleteBlob: jest.fn().mockResolvedValue(undefined),
      } as unknown as BlobStore;
      const remote = {
        enabled: true,
        get: jest.fn().mockResolvedValue({ stream: { destroy: jest.fn() } }),
      } as unknown as RemoteObjectStore;
      const free = { assertWritable: jest.fn().mockResolvedValue(undefined) } as unknown as FreeSpaceService;
      const svc = new TieringService(em, blobs, SSE, makeConfig(), CLOCK, remote, free);
      return { svc, blobs, remote, free, tem };
    }

    it('fetches, stages, verifies integrity, and flips the row back to LOCAL', async () => {
      const { svc, remote, tem } = setup();
      await svc.rehydrate('b', 'k');
      expect(remote.get).toHaveBeenCalledWith('b', 'k', expect.objectContaining({ signal: expect.anything() }));
      const row = await (tem.findOne as jest.Mock).mock.results[0].value;
      expect(row.location).toBe(ObjectLocation.Local);
      expect(row.remoteKey).toBeUndefined();
    });

    it('single-flight: two concurrent rehydrations trigger exactly one remote GET', async () => {
      const { svc, remote } = setup();
      await Promise.all([svc.rehydrate('b', 'k'), svc.rehydrate('b', 'k')]);
      expect((remote.get as jest.Mock)).toHaveBeenCalledTimes(1);
    });

    it('500s and drops the staged blob on an integrity mismatch (never serve unverified bytes)', async () => {
      const { svc, blobs } = setup({}, 'b'.repeat(64)); // staged sha != stored
      await expect(svc.rehydrate('b', 'k')).rejects.toBeInstanceOf(InternalError);
      expect(blobs.deleteBlob).toHaveBeenCalledWith('b', 'k');
    });

    it('caps global concurrency with 503 SlowDown', async () => {
      const obj = stub();
      const { em } = makeEm(obj);
      // Block the first rehydrate inside putBlob so the second sees the cap.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const blobs = {
        putBlob: jest.fn().mockImplementation(async () => {
          await gate;
          return { sha256: SHA, size: 5n, etag: 'e', finalPath: '/p' };
        }),
        deleteBlob: jest.fn(),
      } as unknown as BlobStore;
      const remote = {
        enabled: true,
        get: jest.fn().mockResolvedValue({ stream: { destroy: jest.fn() } }),
      } as unknown as RemoteObjectStore;
      const free = { assertWritable: jest.fn().mockResolvedValue(undefined) } as unknown as FreeSpaceService;
      const svc = new TieringService(em, blobs, SSE, makeConfig({ tierMaxConcurrentRehydrate: 1 }), CLOCK, remote, free);

      const first = svc.rehydrate('b', 'k1');
      await Promise.resolve();
      await expect(svc.rehydrate('b', 'k2')).rejects.toBeInstanceOf(SlowDownError);
      release();
      await first;
    });
  });

  describe('redirectUrlFor', () => {
    it('delegates to the remote presigner with the configured TTL', async () => {
      const { em } = makeEm(stub());
      const remote = {
        enabled: true,
        presignGet: jest.fn().mockResolvedValue('https://remote/presigned?X-Amz-Expires=300'),
      } as unknown as RemoteObjectStore;
      const svc = new TieringService(em, {} as BlobStore, SSE, makeConfig({ tierPresignTtlSeconds: 300 }), CLOCK, remote);
      const url = await svc.redirectUrlFor('b', 'k', 'bytes=0-10');
      expect(remote.presignGet).toHaveBeenCalledWith('b', 'k', 300, 'bytes=0-10');
      expect(url).not.toContain('AWS4-HMAC');
    });
  });
});
