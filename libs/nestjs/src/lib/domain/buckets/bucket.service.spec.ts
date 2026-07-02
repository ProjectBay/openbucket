import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { Bucket, ObjectEntity, VersioningState } from '../../persistence/index';

import { BucketService, ROOT_OWNER } from './bucket.service';
import type { ObjectService } from '../objects/object.service';
import type { ContinuationToken } from '../../s3/pagination/continuation-token';

/**
 * TASK-1550 — the canonical unit-test sample (WHITEPAPER §5.20.1, BACKEND-DESIGN
 * §7.1). The principle this file exists to demonstrate: **do not mock the
 * EntityManager or the repositories.** Boot MikroORM against an in-memory
 * libsql (SQLite) database, register the entities under test, build the schema,
 * and drive the real `BucketService` through its real repositories.
 *
 * Only genuinely-unrelated collaborators are stubbed: `ObjectService` and
 * `ContinuationToken` are constructor deps of `BucketService` but are not
 * exercised by create / delete / listBuckets, so they are passed as inert
 * stubs. Every persistence interaction below hits a real EM.
 *
 * Adapted from the white paper's idealized snippet to the real DI graph:
 * `BucketService` takes four constructor args (BucketRepository,
 * ObjectRepository, ObjectService, ContinuationToken), and the repositories are
 * resolved from the ORM via the entities' `repository: () => …` binding.
 */
const ROW_ID = '01920000-0000-7000-8000-000000000abc'; // fixed uuid-v7-shaped id

describe('BucketService (unit, in-memory ORM — TASK-1550 / TEST-0503)', () => {
  let orm: MikroORM;
  let service: BucketService;

  beforeEach(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, ObjectEntity],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true, // the test composes the EM outside a RequestContext
      forceUtcTimezone: true,
    });
    await orm.getSchemaGenerator().createSchema();

    service = new BucketService(
      orm.em.getRepository(Bucket), // real BucketRepository
      orm.em.getRepository(ObjectEntity), // real ObjectRepository
      {} as unknown as ObjectService, // not exercised by the cases below
      {} as unknown as ContinuationToken, // not exercised by the cases below
    );
  });

  afterEach(async () => {
    await orm.close(true);
  });

  it('creates a bucket with default (disabled) versioning', async () => {
    const b = await service.create({
      name: 'photos',
      versioning: 'disabled',
      objectLock: false,
      region: 'us-east-1',
    });
    expect(b.name).toBe('photos');
    expect(b.versioning).toBe(VersioningState.Disabled);
  });

  it('rejects a duplicate bucket name (BucketAlreadyOwnedByYou)', async () => {
    await service.create({ name: 'photos', versioning: 'disabled', objectLock: false, region: 'us-east-1' });
    await expect(
      service.create({ name: 'photos', versioning: 'disabled', objectLock: false, region: 'us-east-1' }),
    ).rejects.toThrow(/already own it/i);
  });

  it('refuses to delete a non-empty bucket (BucketNotEmpty)', async () => {
    const bucket = await service.create({
      name: 'photos',
      versioning: 'disabled',
      objectLock: false,
      region: 'us-east-1',
    });
    // Seed a real object row through the EM — the delete guard counts it.
    orm.em.create(ObjectEntity, { id: ROW_ID, bucket, key: 'cat.jpg', etag: 'deadbeef' });
    await orm.em.flush();

    await expect(service.deleteByName('photos')).rejects.toThrow(/not empty/i);
  });

  it('deletes an empty bucket', async () => {
    await service.create({ name: 'photos', versioning: 'disabled', objectLock: false, region: 'us-east-1' });
    await expect(service.deleteByName('photos')).resolves.toBeUndefined();
    expect(await service.findByName('photos')).toBeNull();
  });

  it('maps stored bucket rows into the ListAllMyBucketsResult envelope', async () => {
    // Inserted out of order to prove listBuckets relies on the repo's ASC sort.
    await service.create({ name: 'beta', versioning: 'disabled', objectLock: false, region: 'us-east-1' });
    await service.create({ name: 'alpha', versioning: 'disabled', objectLock: false, region: 'us-east-1' });

    const out = (await service.listBuckets({} as never, {} as never)) as {
      __root: string;
      Owner: { ID: string; DisplayName: string };
      Buckets: { Bucket: Array<{ Name: string; CreationDate: string }> };
    };

    expect(out.__root).toBe('ListAllMyBucketsResult');
    expect(out.Owner).toEqual({ ID: ROOT_OWNER.ID, DisplayName: ROOT_OWNER.DisplayName });
    expect(out.Buckets.Bucket.map((b) => b.Name)).toEqual(['alpha', 'beta']);
    // CreationDate is a real ISO-8601 timestamp produced by the entity.
    for (const b of out.Buckets.Bucket) {
      expect(b.CreationDate).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
  });
});
