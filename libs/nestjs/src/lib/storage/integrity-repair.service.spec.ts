import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EntityManager } from '@mikro-orm/libsql';

import { BlobStore } from './blob-store';
import { IntegrityRepairService } from './integrity-repair.service';
import { IntegrityVerifier } from './integrity-verifier.service';
import type { ObjectEntity } from '../persistence/entities/object.entity';
import { IntegrityStatus } from '../persistence/entities/types';
import type { ReplicationTargetService } from './replication/replication-target.service';
import type { SseKeyService } from './sse-key.service';

const TMP_ROOT = join(process.cwd(), 'tmp', 'openbucket-integrity-repair-test');
const stubConfig = (dataDir: string): ConfigService =>
  ({ getOrThrow: () => dataDir }) as unknown as ConfigService;

/**
 * TEST-1204 — IntegrityRepairService: repair success, the no-target no-op, and the
 * bad-remote rollback (no bad overwrite). Real BlobStore + IntegrityVerifier over a
 * temporary DATA_DIR; the replication target is mocked.
 */
describe('IntegrityRepairService (TEST-1204)', () => {
  let dataDir: string;
  let store: BlobStore;
  let verifier: IntegrityVerifier;
  const sseKey = { key: () => Buffer.alloc(32, 1) } as unknown as SseKeyService;

  beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());

  beforeEach(async () => {
    dataDir = join(TMP_ROOT, randomUUID());
    await fs.mkdir(dataDir, { recursive: true });
    store = new BlobStore(stubConfig(dataDir));
    verifier = new IntegrityVerifier(store, sseKey);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const good = Buffer.from('the authoritative good bytes of this object');
  const goodSha = createHash('sha256').update(good).digest('hex');

  const objRow = (): ObjectEntity =>
    ({
      bucket: { name: 'b' },
      key: 'k',
      contentSha256: goodSha,
      size: BigInt(good.length),
      encryption: undefined,
    }) as unknown as ObjectEntity;

  const buildTarget = (opts: {
    enabled: boolean;
    remoteBytes?: Buffer;
  }): { target: ReplicationTargetService; getReplicated: jest.Mock } => {
    const getReplicated = jest.fn().mockImplementation(async () => ({
      stream: Readable.from([opts.remoteBytes ?? good]),
      contentLength: (opts.remoteBytes ?? good).length,
      contentType: 'application/octet-stream',
    }));
    return {
      target: { enabled: opts.enabled, getReplicated } as unknown as ReplicationTargetService,
      getReplicated,
    };
  };

  it('case 1: repairs a corrupt local blob from an intact remote copy → ok', async () => {
    // Seed the good blob, then corrupt it on disk.
    const { finalPath } = await store.putBlob('b', 'k', Readable.from([good]));
    const disk = await fs.readFile(finalPath);
    disk[0] ^= 0xff;
    await fs.writeFile(finalPath, disk);

    const { target } = buildTarget({ enabled: true });
    const nativeUpdate = jest.fn().mockResolvedValue(1);
    const em = { nativeUpdate } as unknown as EntityManager;
    const svc = new IntegrityRepairService(target, store, verifier, sseKey, em);

    const outcome = await svc.repair(objRow());
    expect(outcome).toBe('repaired');
    // On-disk bytes match the stored digest again.
    expect((await fs.readFile(finalPath)).equals(good)).toBe(true);
    // Row flipped to ok.
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ key: 'k' }),
      expect.objectContaining({ integrityStatus: IntegrityStatus.Ok }),
    );
  });

  it('case 2: no target configured → skipped-no-target, no remote call', async () => {
    const { target, getReplicated } = buildTarget({ enabled: false });
    const nativeUpdate = jest.fn();
    const em = { nativeUpdate } as unknown as EntityManager;
    const svc = new IntegrityRepairService(target, store, verifier, sseKey, em);

    const outcome = await svc.repair(objRow());
    expect(outcome).toBe('skipped-no-target');
    expect(getReplicated).not.toHaveBeenCalled();
    expect(nativeUpdate).not.toHaveBeenCalled();
  });

  it('case 3: a remote copy that also fails the digest leaves the local blob unchanged', async () => {
    const { finalPath } = await store.putBlob('b', 'k', Readable.from([good]));
    const disk = await fs.readFile(finalPath);
    disk[0] ^= 0xff;
    await fs.writeFile(finalPath, disk);
    const corruptedLocal = await fs.readFile(finalPath);

    // The remote copy is ALSO bad (different bytes → wrong digest).
    const { target } = buildTarget({ enabled: true, remoteBytes: Buffer.from('divergent bad remote') });
    const nativeUpdate = jest.fn();
    const em = { nativeUpdate } as unknown as EntityManager;
    const svc = new IntegrityRepairService(target, store, verifier, sseKey, em);

    const outcome = await svc.repair(objRow());
    expect(outcome).toBe('failed');
    // Local blob rolled back to exactly what it was (no bad overwrite), row untouched.
    expect((await fs.readFile(finalPath)).equals(corruptedLocal)).toBe(true);
    expect(nativeUpdate).not.toHaveBeenCalled();
  });
});
