import { MikroORM } from '@mikro-orm/better-sqlite';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { Bucket } from './entities/bucket.entity';
import { ObjectEntity } from './entities/object.entity';
import { ObjectVersion } from './entities/object-version.entity';
import { VersioningState } from './entities/types';

/**
 * TEST-0201 — core entity persistence round-trip against a real :memory:
 * SQLite (no mocks, per BACKEND-DESIGN §7.1).
 *
 * The initial migration is STORY-0205, so the schema is built here from entity
 * metadata via the SchemaGenerator rather than `migration:up`.
 */
describe('core entities (TEST-0201)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, ObjectEntity, ObjectVersion],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false }, // JSON cache can't serialize bigint defaults
      allowGlobalContext: true,
      forceUtcTimezone: true,
      pool: {
        afterCreate: (conn: any, done: (err?: Error) => void) => {
          conn.pragma('foreign_keys = ON'); // required for the cascade case
          done();
        },
      },
    });
    await orm.schema.createSchema();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  it('case 1: JSON cors array round-trips byte-for-byte', async () => {
    const em = orm.em.fork();
    em.create(Bucket, {
      name: 'b',
      versioning: VersioningState.Enabled,
      cors: [{ allowedOrigins: ['*'], allowedMethods: ['GET'] }],
    });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(Bucket, { name: 'b' });
    expect(read.cors).toEqual([{ allowedOrigins: ['*'], allowedMethods: ['GET'] }]);
    expect(read.versioning).toBe(VersioningState.Enabled);
  });

  it('case 2: region/versioning fall back to defaults', async () => {
    const em = orm.em.fork();
    em.create(Bucket, { name: 'b-default' });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(Bucket, { name: 'b-default' });
    expect(read.region).toBe('us-east-1');
    expect(read.versioning).toBe('disabled');
  });

  it('case 3: uq_objects_bucket_key rejects a duplicate (bucket, key)', async () => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: 'b-uniq' });
    em.create(ObjectEntity, { id: 'o1', bucket, key: 'dup', etag: 'e' });
    await em.flush();

    em.create(ObjectEntity, { id: 'o2', bucket, key: 'dup', etag: 'e' });
    await expect(em.flush()).rejects.toThrow();
  });

  it('case 4: deleting a bucket cascade-deletes its object_versions', async () => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: 'b-cascade', versioning: VersioningState.Enabled });
    em.create(ObjectVersion, { bucket, key: 'k', versionId: 'v1', etag: 'e' });
    em.create(ObjectVersion, { bucket, key: 'k', versionId: 'v2', etag: 'e' });
    await em.flush();
    em.clear();

    await em.removeAndFlush(await em.findOneOrFail(Bucket, { name: 'b-cascade' }));
    em.clear();

    expect(await em.count(ObjectVersion, { bucket: { name: 'b-cascade' } })).toBe(0);
  });

  it('case 5: bigint size is preserved', async () => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: 'b-big' });
    em.create(ObjectEntity, { id: 'o-big', bucket, key: 'k', etag: 'e', size: 12345678901234n });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(ObjectEntity, { id: 'o-big' });
    expect(read.size).toBe(12345678901234n);
  });

  it('case 6: a delete-marker version persists (isDeleteMarker, size 0, empty etag)', async () => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: 'b-dm', versioning: VersioningState.Enabled });
    em.create(ObjectVersion, {
      bucket,
      key: 'k',
      versionId: 'vdm',
      etag: '',
      size: 0n,
      isDeleteMarker: true,
    });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(ObjectVersion, { bucket: { name: 'b-dm' }, key: 'k', versionId: 'vdm' });
    expect(read.isDeleteMarker).toBe(true);
    expect(read.size).toBe(0n);
  });
});
