import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import {
  Bucket,
  ObjectEntity,
  ObjectLocation,
  StorageClass,
  TieringState,
  VersioningState,
} from './index';

/**
 * TEST-0901 — TieringState persistence + object-row tiering columns. Schema built
 * via the SchemaGenerator from entity metadata (mirrors lifecycle-state.spec).
 */
describe('TieringState + object tiering columns (TEST-0901)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, ObjectEntity, TieringState],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
      pool: {
        afterCreate: (conn: any, done: (err?: Error) => void) => {
          conn.pragma('foreign_keys = ON');
          done();
        },
      },
    });
    await orm.schema.createSchema();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  it('case 1: MikroORM discovers TieringState; a fresh row has NULL cursor fields', async () => {
    const em = orm.em.fork();
    em.create(TieringState, { bucket: em.create(Bucket, { name: 'b' }), ruleId: 'r1' });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(TieringState, { bucket: { name: 'b' }, ruleId: 'r1' });
    expect(read.lastSweepAt ?? null).toBeNull();
    expect(read.lastKeyProcessed ?? null).toBeNull();
  });

  it('case 2: deleting the bucket cascade-deletes its tiering cursor rows', async () => {
    const em = orm.em.fork();
    await em.removeAndFlush(await em.findOneOrFail(Bucket, { name: 'b' }));
    em.clear();
    expect(await em.count(TieringState, { bucket: { name: 'b' } })).toBe(0);
  });

  it('case 3: a pre-tiering object row defaults to location=local, null tiering fields', async () => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: 'ob', versioning: VersioningState.Disabled });
    em.create(ObjectEntity, { id: 'o1', bucket, key: 'k', size: 5n, etag: 'e' });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(ObjectEntity, { bucket: { name: 'ob' }, key: 'k' });
    expect(read.location).toBe(ObjectLocation.Local);
    expect(read.remoteKey ?? null).toBeNull();
    expect(read.tieredAt ?? null).toBeNull();
    expect(read.lastAccessedAt ?? null).toBeNull();
    expect(read.storageClass).toBe(StorageClass.Standard);
  });

  it('case 4: a tiered stub round-trips location=remote + remoteKey + tieredAt', async () => {
    const em = orm.em.fork();
    const row = await em.findOneOrFail(ObjectEntity, { bucket: { name: 'ob' }, key: 'k' });
    row.location = ObjectLocation.Remote;
    row.remoteKey = 'k';
    row.tieredAt = new Date('2026-07-05T00:00:00.000Z');
    row.storageClass = StorageClass.Glacier;
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(ObjectEntity, { bucket: { name: 'ob' }, key: 'k' });
    expect(read.location).toBe(ObjectLocation.Remote);
    expect(read.remoteKey).toBe('k');
    expect(read.storageClass).toBe(StorageClass.Glacier);
    expect(read.tieredAt?.toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });
});
