import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

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
  EventDeliveryEntity,
  VersioningState,
} from '../persistence/index';

import { BlobStore } from './blob-store';
import { ObjectWriterService } from './object-writer.service';
import { decryptBuffer } from './sse-cipher';
import { ObjectEventsService } from '../events/object-events.service';
import type { ObjectEvent } from '../events/object-event.types';
import { Migration20260520000001_initial } from '../migrations/Migration20260520000001_initial';
import { Migration20260625000001_object_encryption } from '../migrations/Migration20260625000001_object_encryption';
import { Migration20260701000001_object_content_sha256 } from '../migrations/Migration20260701000001_object_content_sha256';
import { Migration20260702000001_event_deliveries } from '../migrations/Migration20260702000001_event_deliveries';

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
  EventDeliveryEntity,
];

const stubConfig = (dataDir: string): ConfigService =>
  ({ getOrThrow: () => dataDir }) as unknown as ConfigService;

/**
 * TEST-0209 — two-phase commit happy path + rollback. Real :memory: MikroORM
 * with the initial migration applied; real temp DATA_DIR for the path-mirror.
 */
describe('ObjectWriterService (TEST-0209)', () => {
  let orm: MikroORM;
  let dataDir: string;
  let writer: ObjectWriterService;
  let blobs: BlobStore;

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', `openbucket-writer-test-${randomUUID()}`);
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
          { name: 'Migration20260625000001_object_encryption', class: Migration20260625000001_object_encryption },
          { name: 'Migration20260701000001_object_content_sha256', class: Migration20260701000001_object_content_sha256 },
          { name: 'Migration20260702000001_event_deliveries', class: Migration20260702000001_event_deliveries },
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

    // Seed both buckets.
    const seedEm = orm.em.fork();
    seedEm.create(Bucket, { name: 'b', versioning: VersioningState.Disabled });
    seedEm.create(Bucket, { name: 'bv', versioning: VersioningState.Enabled });
    await seedEm.flush();

    blobs = new BlobStore(stubConfig(dataDir));
    writer = new ObjectWriterService(orm.em as EntityManager, blobs, { key: () => Buffer.alloc(32) } as unknown as import('./sse-key.service').SseKeyService);
  }, 60_000);

  afterEach(async () => {
    await orm?.close(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('case 1: happy path, non-versioned', async () => {
    const row = await writer.put({ bucket: 'b', key: 'k', body: Readable.from(['hello']) });
    expect(row.size).toBe(5n);
    expect(row.etag).toBe(createHash('md5').update('hello').digest('hex'));
    expect(row.storageClass).toBe('STANDARD');
    expect(row.softDeleted).toBe(false);

    const em = orm.em.fork();
    expect(await em.count(ObjectEntity, { bucket: { name: 'b' }, key: 'k' })).toBe(1);
    expect(await em.count(ObjectVersion, { bucket: { name: 'b' }, key: 'k' })).toBe(0);
    expect((await fs.readFile(blobs.paths.blobPath('b', 'k'))).toString()).toBe('hello');
  });

  it('case 1b: SSE bucket stores ciphertext on disk; ETag/size stay over plaintext (STORY-0122)', async () => {
    // Enable default encryption on bucket 'b'. sseKey stub returns a 32-byte zero key.
    const seed = orm.em.fork();
    const b = await seed.findOneOrFail(Bucket, { name: 'b' });
    b.encryption = { algorithm: 'AES256' };
    await seed.flush();

    const plaintext = 'this is a secret payload that must be encrypted at rest';
    const row = await writer.put({ bucket: 'b', key: 'enc', body: Readable.from([plaintext]) });

    expect(row.encryption?.algorithm).toBe('AES256');
    expect(row.etag).toBe(createHash('md5').update(plaintext).digest('hex')); // plaintext ETag
    expect(row.size).toBe(BigInt(Buffer.byteLength(plaintext)));

    const onDisk = await fs.readFile(blobs.paths.blobPath('b', 'enc'));
    expect(onDisk.equals(Buffer.from(plaintext))).toBe(false); // ciphertext, not plaintext
    expect(onDisk.length).toBe(Buffer.byteLength(plaintext)); // CTR is length-preserving

    const iv = Buffer.from(row.encryption!.iv, 'base64');
    expect(decryptBuffer(Buffer.alloc(32), iv, onDisk).toString()).toBe(plaintext);
  });

  it('case 2: happy path, versioned bucket creates ObjectVersion + sets currentVersionId', async () => {
    const row = await writer.put({ bucket: 'bv', key: 'k', body: Readable.from(['hi']) });
    expect(row.currentVersionId).toBeDefined();

    const em = orm.em.fork();
    const versions = await em.find(ObjectVersion, { bucket: { name: 'bv' }, key: 'k' });
    expect(versions).toHaveLength(1);
    expect(versions[0].versionId).toBe(row.currentVersionId);
    expect(versions[0].isDeleteMarker).toBe(false);
    expect(versions[0].size).toBe(2n);
    expect(versions[0].etag).toBe(row.etag);
  });

  it('case 3: a second PUT to the same key updates the single pointer row', async () => {
    await writer.put({ bucket: 'b', key: 'k3', body: Readable.from(['v1']) });
    await writer.put({ bucket: 'b', key: 'k3', body: Readable.from(['v2-longer']) });

    const em = orm.em.fork();
    expect(await em.count(ObjectEntity, { bucket: { name: 'b' }, key: 'k3' })).toBe(1);
    expect((await fs.readFile(blobs.paths.blobPath('b', 'k3'))).toString()).toBe('v2-longer');
  });

  it('case 4: commit failure rolls back + unlinks the renamed file', async () => {
    const commitSpy = jest
      .spyOn(EntityManager.prototype, 'commit')
      .mockRejectedValueOnce(new Error('synthetic-commit-fail'));

    await expect(
      writer.put({ bucket: 'b', key: 'k4', body: Readable.from(['x']) }),
    ).rejects.toThrow(/synthetic-commit-fail/);

    const em = orm.em.fork();
    expect(await em.count(ObjectEntity, { bucket: { name: 'b' }, key: 'k4' })).toBe(0);
    expect(existsSync(blobs.paths.blobPath('b', 'k4'))).toBe(false);

    commitSpy.mockRestore();
  });

  it('case 5: unlink-after-commit-error failure logs a warn', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const commitSpy = jest
      .spyOn(EntityManager.prototype, 'commit')
      .mockRejectedValueOnce(new Error('synthetic-commit-fail'));
    const unlinkSpy = jest
      .spyOn(fs, 'unlink')
      .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    await expect(
      writer.put({ bucket: 'b', key: 'k5', body: Readable.from(['x']) }),
    ).rejects.toThrow(/synthetic-commit-fail/);
    const calls = warnSpy.mock.calls.flat().join(' ');
    expect(calls).toMatch(/failed to clean up post-rename file after commit error:/);

    commitSpy.mockRestore();
    unlinkSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('case 6: orphan-blob baseline — file remains, no row, when both commit and unlink fail', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const commitSpy = jest
      .spyOn(EntityManager.prototype, 'commit')
      .mockRejectedValueOnce(new Error('crash-before-commit'));
    const unlinkSpy = jest
      .spyOn(fs, 'unlink')
      .mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));

    await expect(
      writer.put({ bucket: 'b', key: 'orphan', body: Readable.from(['orphan-bytes']) }),
    ).rejects.toThrow();

    // Orphan-blob baseline: file at the final path, no row in objects.
    expect(existsSync(blobs.paths.blobPath('b', 'orphan'))).toBe(true);
    const em = orm.em.fork();
    expect(await em.count(ObjectEntity, { bucket: { name: 'b' }, key: 'orphan' })).toBe(0);

    commitSpy.mockRestore();
    unlinkSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // --- object events + transactional outbox (STORY-0801) ---
  describe('events (STORY-0801)', () => {
    const eventsConfig = () =>
      ({
        webhooksEnabled: true,
        webhookEvents: ['object.created', 'object.deleted', 'multipart.completed'],
      }) as never;

    it('emits exactly one object.created (post-commit) with the right payload', async () => {
      const emitted: ObjectEvent[] = [];
      const events = { emitInProcess: (e: ObjectEvent) => emitted.push(e), enqueueInTx: () => undefined } as unknown as ObjectEventsService;
      const w = new ObjectWriterService(
        orm.em as EntityManager,
        blobs,
        { key: () => Buffer.alloc(32) } as never,
        undefined,
        events,
      );

      const row = await w.put({ bucket: 'b', key: 'ev', body: Readable.from(['hello']) });

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        type: 'object.created',
        bucket: 'b',
        key: 'ev',
        size: 5,
        etag: row.etag,
        eventTime: row.modifiedAt.toISOString(),
      });
    });

    it('does NOT emit when the commit rolls back', async () => {
      const emitted: ObjectEvent[] = [];
      const events = { emitInProcess: (e: ObjectEvent) => emitted.push(e), enqueueInTx: () => undefined } as unknown as ObjectEventsService;
      const w = new ObjectWriterService(
        orm.em as EntityManager,
        blobs,
        { key: () => Buffer.alloc(32) } as never,
        undefined,
        events,
      );
      const commitSpy = jest
        .spyOn(EntityManager.prototype, 'commit')
        .mockRejectedValueOnce(new Error('synthetic-commit-fail'));

      await expect(
        w.put({ bucket: 'b', key: 'ev-rb', body: Readable.from(['x']) }),
      ).rejects.toThrow(/synthetic-commit-fail/);

      expect(emitted).toHaveLength(0);
      commitSpy.mockRestore();
    });

    it('transactional outbox: a committed write inserts one pending event_deliveries row', async () => {
      const real = new ObjectEventsService({ emitAsync: () => Promise.resolve([]) } as never, eventsConfig());
      const w = new ObjectWriterService(
        orm.em as EntityManager,
        blobs,
        { key: () => Buffer.alloc(32) } as never,
        undefined,
        real,
      );

      await w.put({ bucket: 'b', key: 'ob', body: Readable.from(['data']) });

      const em = orm.em.fork();
      const rows = await em.find(EventDeliveryEntity, {});
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].eventType).toBe('object.created');
      expect(JSON.parse(rows[0].payload).key).toBe('ob');
    });

    it('transactional outbox: a rolled-back write leaves zero event_deliveries rows', async () => {
      const real = new ObjectEventsService({ emitAsync: () => Promise.resolve([]) } as never, eventsConfig());
      const w = new ObjectWriterService(
        orm.em as EntityManager,
        blobs,
        { key: () => Buffer.alloc(32) } as never,
        undefined,
        real,
      );
      const commitSpy = jest
        .spyOn(EntityManager.prototype, 'commit')
        .mockRejectedValueOnce(new Error('synthetic-commit-fail'));

      await expect(
        w.put({ bucket: 'b', key: 'ob-rb', body: Readable.from(['data']) }),
      ).rejects.toThrow(/synthetic-commit-fail/);

      const em = orm.em.fork();
      expect(await em.count(EventDeliveryEntity, {})).toBe(0);
      commitSpy.mockRestore();
    });
  });
});
