import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

// This spec imports through the persistence barrel (./index) — case 5 below
// asserts the barrel re-exports every entity/repository symbol.
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
  BucketRepository,
  ObjectRepository,
  VersioningState,
  StorageClass,
} from './index';

/**
 * TEST-0204 — LifecycleState persistence + barrel export integrity.
 * Schema built via the SchemaGenerator (initial migration is STORY-0205).
 */
describe('LifecycleState + barrel (TEST-0204)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, LifecycleState],
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

  it('case 1: a fresh row has NULL lastSweepAt / lastKeyProcessed', async () => {
    const em = orm.em.fork();
    em.create(LifecycleState, { bucket: em.create(Bucket, { name: 'b' }), ruleId: 'r1' });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(LifecycleState, { bucket: { name: 'b' }, ruleId: 'r1' });
    expect(read.lastSweepAt ?? null).toBeNull();
    expect(read.lastKeyProcessed ?? null).toBeNull();
  });

  it('case 2: lastKeyProcessed update round-trips', async () => {
    const em = orm.em.fork();
    const row = await em.findOneOrFail(LifecycleState, { bucket: { name: 'b' }, ruleId: 'r1' });
    row.lastKeyProcessed = 'photos/2026/may.jpg';
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(LifecycleState, { bucket: { name: 'b' }, ruleId: 'r1' });
    expect(read.lastKeyProcessed).toBe('photos/2026/may.jpg');
  });

  it('case 3: two rules for one bucket both persist', async () => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: 'b3' });
    em.create(LifecycleState, { bucket, ruleId: 'ra' });
    em.create(LifecycleState, { bucket, ruleId: 'rb' });
    await em.flush();
    em.clear();

    expect(await em.count(LifecycleState, { bucket: { name: 'b3' } })).toBe(2);
  });

  it('case 4: deleting the bucket cascade-deletes its lifecycle rows', async () => {
    const em = orm.em.fork();
    await em.removeAndFlush(await em.findOneOrFail(Bucket, { name: 'b3' }));
    em.clear();
    expect(await em.count(LifecycleState, { bucket: { name: 'b3' } })).toBe(0);
  });

  it('case 5: the persistence barrel exports every symbol', () => {
    for (const sym of [
      Bucket,
      ObjectEntity,
      ObjectVersion,
      MultipartUpload,
      MultipartPart,
      AccessKey,
      AdminUser,
      RefreshToken,
      LifecycleState,
      BucketRepository,
      ObjectRepository,
    ]) {
      expect(sym).toBeDefined();
    }
    expect(VersioningState.Enabled).toBe('enabled');
    expect(StorageClass.Standard).toBe('STANDARD');
  });
});
