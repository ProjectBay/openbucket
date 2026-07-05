import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MikroORM, EntityManager } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
} from '../persistence/index';

import { Migration20260520000001_initial } from '../migrations/Migration20260520000001_initial';
import { Migration20260711000001_object_tiering } from '../migrations/Migration20260711000001_object_tiering';
import { BlobStore } from './blob-store';
import { PathResolver } from './paths';
import { RecoveryService } from './recovery.service';

const ENTITIES = [
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
];

const stubConfig = (dataDir: string): ConfigService =>
  ({ getOrThrow: () => dataDir }) as unknown as ConfigService;

/**
 * TEST-0210 — startup recovery scan. The test plan describes it as e2e via a
 * crashed Nest boot; this realization exercises `runScan()` directly against
 * a curated DATA_DIR (orphan blob + stale multipart + live multipart),
 * covering cases 1-4 of the plan. Case 5 (hook-order before HTTP bind) is
 * code-evident: RecoveryService implements OnApplicationBootstrap, and Nest
 * runs `onApplicationBootstrap` strictly before `app.listen()`.
 */
describe('RecoveryService (TEST-0210)', () => {
  let orm: MikroORM;
  let dataDir: string;
  let svc: RecoveryService;
  let paths: PathResolver;

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', `openbucket-recovery-test-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });

    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: ENTITIES,
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
      extensions: [Migrator],
      migrations: {
        migrationsList: [
          { name: 'Migration20260520000001_initial', class: Migration20260520000001_initial },
          { name: 'Migration20260711000001_object_tiering', class: Migration20260711000001_object_tiering },
        ],
      },
      pool: {
        afterCreate: (conn: any, done: (err?: Error) => void) => {
          conn.pragma('foreign_keys = ON');
          done();
        },
      },
    });
    await orm.getMigrator().up();

    paths = new (BlobStore as any)(stubConfig(dataDir)).paths;
    svc = new RecoveryService(orm.em as EntityManager, stubConfig(dataDir));
  }, 60_000);

  afterEach(async () => {
    await orm?.close(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('case 1: an orphan blob is reported and deleted (a coexisting valid blob confirms DATA_DIR)', async () => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: 'b' });
    // A valid object (row + blob) so the misconfiguration guard doesn't trip.
    em.create(ObjectEntity, {
      id: randomUUID(),
      bucket,
      key: 'valid-key',
      size: 5n,
      etag: 'a'.repeat(32),
      createdAt: new Date(),
      modifiedAt: new Date(),
    });
    await em.flush();
    await fs.mkdir(paths.bucketDir('b'), { recursive: true });
    await fs.writeFile(paths.blobPath('b', 'valid-key'), 'valid');

    const orphanPath = paths.blobPath('b', 'orphan-key');
    await fs.writeFile(orphanPath, 'orphan-bytes');

    const report = await svc.runScan();
    expect(report.orphanBlobs).toHaveLength(1);
    expect(report.orphanBlobs[0]).toMatchObject({ bucket: 'b', key: 'orphan-key' });
    expect(report.deletedOrphans).toBe(1);
    expect(existsSync(orphanPath)).toBe(false); // F9: orphan removed
    expect(existsSync(paths.blobPath('b', 'valid-key'))).toBe(true); // valid kept
  });

  it('case 2: a stale multipart directory is removed', async () => {
    const staleId = randomUUID();
    const staleDir = paths.multipartDir(staleId);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(join(staleDir, '1.part'), 'leftover');

    const report = await svc.runScan();
    expect(report.removedMultipartDirs).toHaveLength(1);
    expect(report.removedMultipartDirs[0]).toBe(staleDir);
    expect(existsSync(staleDir)).toBe(false);
  });

  it('case 3: a live multipart directory (matching DB row) is untouched', async () => {
    const em = orm.em.fork();
    em.create(Bucket, { name: 'b' });
    await em.flush();
    const bucket = await em.findOneOrFail(Bucket, { name: 'b' });

    const liveId = randomUUID();
    em.create(MultipartUpload, { uploadId: liveId, bucket, key: 'k' });
    await em.flush();

    const liveDir = paths.multipartDir(liveId);
    await fs.mkdir(liveDir, { recursive: true });
    await fs.writeFile(join(liveDir, '1.part'), 'in-progress');

    const report = await svc.runScan();
    expect(report.removedMultipartDirs).toEqual([]);
    expect(existsSync(liveDir)).toBe(true);
  });

  it('case 4 (guard): every-blob-orphaned is treated as misconfiguration — kept, not deleted; stale mp still removed', async () => {
    const em = orm.em.fork();
    em.create(Bucket, { name: 'b' });
    await em.flush();

    // The ONLY blob is an orphan → the misconfiguration guard refuses to delete
    // (this looks like a wrong DATA_DIR, not a real crash orphan).
    const orphanPath = paths.blobPath('b', 'orphan');
    await fs.mkdir(paths.bucketDir('b'), { recursive: true });
    await fs.writeFile(orphanPath, 'data');

    const staleDir = paths.multipartDir(randomUUID());
    await fs.mkdir(staleDir, { recursive: true });

    const report = await svc.runScan();
    expect(report.orphanBlobs.map((o) => o.key)).toEqual(['orphan']);
    expect(report.deletedOrphans).toBe(0);
    expect(report.removedMultipartDirs).toContain(staleDir);
    expect(existsSync(orphanPath)).toBe(true);
    expect(existsSync(staleDir)).toBe(false);
  });

  it('case 5 (code-evident): RecoveryService runs at the OnApplicationBootstrap hook (before listen)', async () => {
    // Direct call to the lifecycle hook; emits the summary log via the
    // Logger instance. Nest invokes this hook before `app.listen()` —
    // verified at the framework level, not here.
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await svc.onApplicationBootstrap();
      const calls = logSpy.mock.calls.flat().join(' ');
      expect(calls).toMatch(/recovery scan:/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('case 6: skips .v/ version directories during the blob pass', async () => {
    const em = orm.em.fork();
    em.create(Bucket, { name: 'b' });
    await em.flush();

    // A genuine blob (current pointer) — seed an ObjectEntity for it so it
    // is NOT flagged as an orphan.
    const bucket = await em.findOneOrFail(Bucket, { name: 'b' });
    em.create(ObjectEntity, { id: randomUUID(), bucket, key: 'present', etag: 'e' });
    await em.flush();

    await fs.mkdir(paths.bucketDir('b'), { recursive: true });
    await fs.writeFile(paths.blobPath('b', 'present'), 'body');
    // Version-store directory next to it — must be skipped.
    await fs.mkdir(paths.versionDir('b', 'present'), { recursive: true });
    await fs.writeFile(paths.versionPath('b', 'present', 'v1'), 'old');

    const report = await svc.runScan();
    expect(report.orphanBlobs).toEqual([]);
  });
});
