import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

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

import { BlobStore } from '../storage/blob-store';
import { ObjectWriterService } from '../storage/object-writer.service';
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
const streamOf = (s: string) => Readable.from([Buffer.from(s)]);
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/**
 * TEST-0317 — concurrency invariants (§4.8). Real :memory: MikroORM + a temp
 * DATA_DIR. Covers the same-partNumber O_EXCL collision tolerance (now testable
 * with the real UploadPart staging) and PUT-same-key last-rename-wins.
 */
describe('concurrency invariants (TEST-0317)', () => {
  let orm: MikroORM;
  let dataDir: string;
  let blobs: BlobStore;
  let writer: ObjectWriterService;

  beforeAll(async () => {
    dataDir = join(process.cwd(), 'tmp', `ob-concurrency-${randomUUID()}`);
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
        afterCreate: (conn: { pragma: (s: string) => void }, done: () => void) => {
          conn.pragma('foreign_keys = ON');
          done();
        },
      },
    });
    await orm.getMigrator().up();
    const seed = orm.em.fork();
    seed.create(Bucket, { name: 'b', versioning: VersioningState.Disabled });
    await seed.flush();
    blobs = new BlobStore(stubConfig(dataDir));
    writer = new ObjectWriterService(orm.em as EntityManager, blobs, { key: () => Buffer.alloc(32) } as unknown as import('../storage/sse-key.service').SseKeyService);
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  // These two cases assert concurrency invariants for writers racing on the SAME
  // target. Both were quarantined (it.skip) while the write path could tear under
  // that race; the hardening they waited on has since landed, so they are now
  // active and deterministic:
  //   • same-partNumber UploadPart: each writer stages to a randomUUID-suffixed
  //     tmp file (no O_EXCL collision) and rename(2)s onto the shared `<n>.part`.
  //     On POSIX (Linux CI, macOS dev) rename-over-existing is atomic last-wins,
  //     so the final part is exactly one whole writer's payload — no tear, no
  //     EEXIST. (Windows rename-over is the only remaining platform caveat; the
  //     CI runner is Linux.)
  //   • concurrent first-time same-key PUT: ObjectWriterService now serializes
  //     writers of the same (bucket,key) through a keyed async mutex
  //     (`withKeyLock`, F6, commit c87ef90), so the two PUTs run strictly one
  //     after the other — the loser's rollback can no longer unlink the winner's
  //     committed blob. Row, blob bytes, and ETag all agree on one winner.
  // See s3/CONCURRENCY.md §4.8.
  it('same-partNumber concurrent UploadPart does not throw EEXIST; the part is one whole writer', async () => {
    const uploadId = 'concurrent-upload';
    const a = 'A'.repeat(4096);
    const b = 'B'.repeat(8192);

    // randomUUID tmp suffix → no O_EXCL collision; both resolve.
    const [ra, rb] = await Promise.all([
      blobs.putPart(uploadId, 1, streamOf(a)),
      blobs.putPart(uploadId, 1, streamOf(b)),
    ]);
    expect(ra.etag).toBe(md5(a));
    expect(rb.etag).toBe(md5(b));

    // The final <1>.part is exactly one writer's payload — atomic rename, no tear.
    const content = readFileSync(blobs.paths.multipartPartPath(uploadId, 1), 'utf8');
    expect([a, b]).toContain(content);
    expect([a.length, b.length]).toContain(content.length);
  });

  it('sequential PUT same key: the second write wins the row, blob, and ETag', async () => {
    await writer.put({ bucket: 'b', key: 'seq', body: streamOf('first') });
    const second = await writer.put({ bucket: 'b', key: 'seq', body: streamOf('second-wins') });

    const em = orm.em.fork();
    const row = await em.findOneOrFail(ObjectEntity, { bucket: { name: 'b' }, key: 'seq' });
    expect(Number(row.size)).toBe('second-wins'.length);
    expect(row.etag).toBe(second.etag);
    expect((await fs.readFile(blobs.paths.blobPath('b', 'seq'))).toString()).toBe('second-wins');
  });

  it('concurrent PUT same key: the per-key write lock serializes the writers; row + blob agree on one winner', async () => {
    const x = 'X'.repeat(500);
    const y = 'Y'.repeat(700);

    const results = await Promise.allSettled([
      writer.put({ bucket: 'b', key: 'race', body: streamOf(x) }),
      writer.put({ bucket: 'b', key: 'race', body: streamOf(y) }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    // No torn write: the row, the blob bytes, and the ETag all describe one winner.
    const em = orm.em.fork();
    const row = await em.findOneOrFail(ObjectEntity, { bucket: { name: 'b' }, key: 'race' });
    const blob = (await fs.readFile(blobs.paths.blobPath('b', 'race'))).toString();
    expect([x, y]).toContain(blob);
    expect(Number(row.size)).toBe(blob.length);
    expect(row.etag).toBe(md5(blob));
  });
});
