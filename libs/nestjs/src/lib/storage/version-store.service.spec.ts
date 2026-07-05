import { createHash, randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { NotFoundException } from '@nestjs/common';
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
  VersioningState,
} from '../persistence/index';

import { BlobStore } from './blob-store';
import { ObjectWriterService } from './object-writer.service';
import { VersionStoreService } from './version-store.service';
import { Migration20260520000001_initial } from '../migrations/Migration20260520000001_initial';
import { Migration20260701000001_object_content_sha256 } from '../migrations/Migration20260701000001_object_content_sha256';
import { Migration20260711000001_object_tiering } from '../migrations/Migration20260711000001_object_tiering';
import { Migration20260716000001_object_integrity } from '../migrations/Migration20260716000001_object_integrity';

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
 * TEST-0213 — versioning lifecycle against real :memory: SQLite + on-disk
 * layout. Covers PUT chains, delete-markers, promoteToCurrent, listVersions,
 * and the demote-on-write step's idempotency + EXDEV fallback + Disabled
 * bypass.
 */
describe('VersionStoreService + demote-on-write (TEST-0213)', () => {
  let orm: MikroORM;
  let dataDir: string;
  let blobs: BlobStore;
  let writer: ObjectWriterService;
  let versions: VersionStoreService;

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', `openbucket-version-test-${randomUUID()}`);
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
          { name: 'Migration20260701000001_object_content_sha256', class: Migration20260701000001_object_content_sha256 },
          { name: 'Migration20260711000001_object_tiering', class: Migration20260711000001_object_tiering },
          { name: 'Migration20260716000001_object_integrity', class: Migration20260716000001_object_integrity },
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

    const seed = orm.em.fork();
    seed.create(Bucket, { name: 'bv', versioning: VersioningState.Enabled });
    seed.create(Bucket, { name: 'b', versioning: VersioningState.Disabled });
    await seed.flush();

    blobs = new BlobStore(stubConfig(dataDir));
    writer = new ObjectWriterService(orm.em as EntityManager, blobs, { key: () => Buffer.alloc(32) } as unknown as import('./sse-key.service').SseKeyService);
    versions = new VersionStoreService(orm.em as EntityManager, blobs, stubConfig(dataDir));
  }, 60_000);

  afterEach(async () => {
    await orm?.close(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('case 1: two-PUT chain keeps v1 under .v/ and v2 as current', async () => {
    const r1 = await writer.put({ bucket: 'bv', key: 'k', body: Readable.from(['v1bytes']) });
    const v1Id = r1.currentVersionId!;
    const r2 = await writer.put({ bucket: 'bv', key: 'k', body: Readable.from(['v2bytes']) });
    const v2Id = r2.currentVersionId!;

    const em = orm.em.fork();
    expect(await em.count(ObjectEntity, { bucket: { name: 'bv' }, key: 'k' })).toBe(1);
    const versionsRows = await em.find(
      ObjectVersion,
      { bucket: { name: 'bv' }, key: 'k' },
      { orderBy: { createdAt: 'ASC' } },
    );
    expect(versionsRows.map((v) => v.versionId)).toEqual([v1Id, v2Id]);

    expect((await fs.readFile(blobs.paths.blobPath('bv', 'k'))).toString()).toBe('v2bytes');
    expect((await fs.readFile(blobs.paths.versionPath('bv', 'k', v1Id))).toString()).toBe('v1bytes');
  });

  it('case 2: three-PUT chain yields 3 version rows + 2 files under .v/', async () => {
    const a = await writer.put({ bucket: 'bv', key: 'm', body: Readable.from(['a']) });
    const b = await writer.put({ bucket: 'bv', key: 'm', body: Readable.from(['b']) });
    await writer.put({ bucket: 'bv', key: 'm', body: Readable.from(['c']) });

    const em = orm.em.fork();
    expect(await em.count(ObjectVersion, { bucket: { name: 'bv' }, key: 'm' })).toBe(3);

    const vdir = await fs.readdir(blobs.paths.versionDir('bv', 'm'));
    expect(vdir.sort()).toEqual([a.currentVersionId!, b.currentVersionId!].sort());
  });

  it('case 3: writeDeleteMarker hides pointer, no .v blob for marker, softDeleted=true', async () => {
    await writer.put({ bucket: 'bv', key: 'd', body: Readable.from(['real']) });
    const marker = await versions.writeDeleteMarker('bv', 'd');

    expect(marker.isDeleteMarker).toBe(true);
    expect(marker.size).toBe(0n);
    expect(existsSync(blobs.paths.blobPath('bv', 'd'))).toBe(false);
    expect(existsSync(blobs.paths.versionPath('bv', 'd', marker.versionId))).toBe(false);

    const em = orm.em.fork();
    const row = await em.findOneOrFail(ObjectEntity, { bucket: { name: 'bv' }, key: 'd' });
    expect(row.softDeleted).toBe(true);
    expect(row.currentVersionId).toBe(marker.versionId);
  });

  it('case 4: promoteToCurrent restores a stored version', async () => {
    const r1 = await writer.put({ bucket: 'bv', key: 'r', body: Readable.from(['v1bytes']) });
    const v1Id = r1.currentVersionId!;
    await writer.put({ bucket: 'bv', key: 'r', body: Readable.from(['v2bytes']) });

    await versions.promoteToCurrent('bv', 'r', v1Id);

    const em = orm.em.fork();
    const row = await em.findOneOrFail(ObjectEntity, { bucket: { name: 'bv' }, key: 'r' });
    expect(row.currentVersionId).toBe(v1Id);
    expect(row.softDeleted).toBe(false);
    expect(row.etag).toBe(createHash('md5').update('v1bytes').digest('hex'));
    expect((await fs.readFile(blobs.paths.blobPath('bv', 'r'))).toString()).toBe('v1bytes');
  });

  it('case 5: promoteToCurrent rejects a delete-marker version', async () => {
    await writer.put({ bucket: 'bv', key: 'dm', body: Readable.from(['real']) });
    const marker = await versions.writeDeleteMarker('bv', 'dm');
    await expect(versions.promoteToCurrent('bv', 'dm', marker.versionId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('case 6: promoteToCurrent rejects an unknown versionId', async () => {
    await writer.put({ bucket: 'bv', key: 'u', body: Readable.from(['only']) });
    await expect(versions.promoteToCurrent('bv', 'u', 'nope-not-a-real-version')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('case 7: listVersions orders key ASC, createdAt DESC', async () => {
    const k1v1 = await writer.put({ bucket: 'bv', key: 'k1', body: Readable.from(['a']) });
    const k1v2 = await writer.put({ bucket: 'bv', key: 'k1', body: Readable.from(['b']) });
    const k2v1 = await writer.put({ bucket: 'bv', key: 'k2', body: Readable.from(['c']) });

    const rows = await versions.listVersions('bv', '', undefined, undefined, 100);
    const ids = rows.map((r) => r.versionId);
    expect(ids).toEqual([k1v2.currentVersionId, k1v1.currentVersionId, k2v1.currentVersionId]);
  });

  it('case 8: listVersions paginates via keyMarker (exclusive)', async () => {
    await writer.put({ bucket: 'bv', key: 'k1', body: Readable.from(['a']) });
    await writer.put({ bucket: 'bv', key: 'k1', body: Readable.from(['b']) });
    const k2 = await writer.put({ bucket: 'bv', key: 'k2', body: Readable.from(['c']) });

    const rows = await versions.listVersions('bv', '', 'k1', undefined, 100);
    expect(rows.map((r) => r.versionId)).toEqual([k2.currentVersionId]);
  });

  it('case 9: listVersions fetches limit + 1 rows for truncation detection', async () => {
    for (let i = 0; i < 5; i++) {
      await writer.put({ bucket: 'bv', key: `k${i}`, body: Readable.from([`b${i}`]) });
    }
    const rows = await versions.listVersions('bv', '', undefined, undefined, 3);
    expect(rows).toHaveLength(4); // limit + 1
  });

  it('case 10: demote is idempotent when <key>.v/<prev> already exists', async () => {
    const r1 = await writer.put({ bucket: 'bv', key: 'idem', body: Readable.from(['v1']) });
    const v1Id = r1.currentVersionId!;
    // Pre-write the .v/<v1> file with arbitrary bytes; demote MUST preserve it.
    const preserved = 'preserved-by-prior-recovery';
    const vPath = blobs.paths.versionPath('bv', 'idem', v1Id);
    await fs.mkdir(blobs.paths.versionDir('bv', 'idem'), { recursive: true });
    await fs.writeFile(vPath, preserved);

    await writer.put({ bucket: 'bv', key: 'idem', body: Readable.from(['v2']) });

    expect((await fs.readFile(vPath)).toString()).toBe(preserved);
    expect((await fs.readFile(blobs.paths.blobPath('bv', 'idem'))).toString()).toBe('v2');
  });

  it('case 11: demote falls back to copyFile on EXDEV', async () => {
    await writer.put({ bucket: 'bv', key: 'x', body: Readable.from(['v1']) });

    const linkSpy = jest
      .spyOn(fs, 'link')
      .mockImplementationOnce(() => Promise.reject(Object.assign(new Error('EXDEV'), { code: 'EXDEV' })));
    const copySpy = jest.spyOn(fs, 'copyFile');

    try {
      await writer.put({ bucket: 'bv', key: 'x', body: Readable.from(['v2']) });
      expect(copySpy).toHaveBeenCalled();
      // The previous bytes ended up in .v/<v1> via the fallback.
      const em = orm.em.fork();
      const allVersions = await em.find(ObjectVersion, { bucket: { name: 'bv' }, key: 'x' });
      const v1Id = allVersions.find((v) => v.etag === createHash('md5').update('v1').digest('hex'))?.versionId;
      expect(v1Id).toBeDefined();
      expect((await fs.readFile(blobs.paths.versionPath('bv', 'x', v1Id!))).toString()).toBe('v1');
    } finally {
      linkSpy.mockRestore();
      copySpy.mockRestore();
    }
  });

  it('case 12: Disabled bucket bypasses the demote step entirely', async () => {
    const linkSpy = jest.spyOn(fs, 'link');
    try {
      await writer.put({ bucket: 'b', key: 'z', body: Readable.from(['only']) });
      await writer.put({ bucket: 'b', key: 'z', body: Readable.from(['updated']) });
      // Demote hard-links the current pointer into the `.v/` version dir. A
      // Disabled bucket must never do that. (The overwrite DOES hard-link the old
      // blob aside as an `.ob-bak.` backup for crash-safety — F2/F3 — which is
      // expected; assert only that no demote link into `.v/` happened.)
      const demoteLinks = linkSpy.mock.calls.filter(([, dst]) => {
        const d = String(dst);
        return d.includes('.v/') || d.includes('.v\\');
      });
      expect(demoteLinks).toHaveLength(0);
    } finally {
      linkSpy.mockRestore();
    }
  });
});
