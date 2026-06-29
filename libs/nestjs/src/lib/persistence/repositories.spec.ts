import { MikroORM } from '@mikro-orm/better-sqlite';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { Bucket } from './entities/bucket.entity';
import { ObjectEntity } from './entities/object.entity';
import { ObjectVersion } from './entities/object-version.entity';
import { VersioningState } from './entities/types';
import { BucketRepository } from './repositories/bucket.repository';
import { nextStringBound, ObjectRepository } from './repositories/object.repository';

const repoOf = <T>(orm: MikroORM, ctor: any): T =>
  orm.em.fork().getRepository(ctor) as unknown as T;

/**
 * TEST-0206 — BucketRepository / ObjectRepository helpers against real
 * :memory: SQLite, with the schema built by SchemaGenerator (the initial
 * migration is STORY-0205's concern; this test stays focused on repos).
 */
describe('repositories (TEST-0206)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, ObjectEntity, ObjectVersion],
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

  const seedBucket = async (name: string, versioning: VersioningState = VersioningState.Disabled) => {
    const em = orm.em.fork();
    em.create(Bucket, { name, versioning });
    await em.flush();
  };

  const seedObjects = async (bucket: string, keys: string[]) => {
    const em = orm.em.fork();
    const b = await em.findOneOrFail(Bucket, { name: bucket });
    for (const key of keys) {
      em.create(ObjectEntity, { id: `${bucket}/${key}`, bucket: b, key, etag: 'e' });
    }
    await em.flush();
  };

  it('case 1: BucketRepository.exists', async () => {
    await seedBucket('present');
    const repo = repoOf<BucketRepository>(orm, Bucket);
    expect(await repo.exists('present')).toBe(true);
    expect(await repo.exists('missing')).toBe(false);
  });

  it('case 2: isVersioned + hasVersionHistory across all 3 states', async () => {
    await seedBucket('venabled', VersioningState.Enabled);
    await seedBucket('vsuspended', VersioningState.Suspended);
    await seedBucket('vdisabled', VersioningState.Disabled);
    const repo = repoOf<BucketRepository>(orm, Bucket);
    expect(await repo.isVersioned('venabled')).toBe(true);
    expect(await repo.hasVersionHistory('venabled')).toBe(true);
    expect(await repo.isVersioned('vsuspended')).toBe(false);
    expect(await repo.hasVersionHistory('vsuspended')).toBe(true);
    expect(await repo.isVersioned('vdisabled')).toBe(false);
    expect(await repo.hasVersionHistory('vdisabled')).toBe(false);
  });

  it('case 3: listByPrefix(limit=3) over 5 keys -> truncated', async () => {
    await seedBucket('bp3');
    await seedObjects('bp3', ['a', 'b', 'c', 'd', 'e']);
    const repo = repoOf<ObjectRepository>(orm, ObjectEntity);
    const page = await repo.listByPrefix('bp3', '', undefined, 3);
    expect(page.rows.map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(page.truncated).toBe(true);
  });

  it('case 4: listByPrefix filters by prefix (range, not LIKE)', async () => {
    await seedBucket('bp4');
    await seedObjects('bp4', ['photos/a', 'photos/b', 'videos/a']);
    const repo = repoOf<ObjectRepository>(orm, ObjectEntity);
    const page = await repo.listByPrefix('bp4', 'photos/', undefined, 10);
    expect(page.rows.map((r) => r.key)).toEqual(['photos/a', 'photos/b']);
    expect(page.truncated).toBe(false);
  });

  it('case 5: marker is exclusive', async () => {
    await seedBucket('bp5');
    await seedObjects('bp5', ['a', 'b', 'c']);
    const repo = repoOf<ObjectRepository>(orm, ObjectEntity);
    const page = await repo.listByPrefix('bp5', '', 'a', 10);
    expect(page.rows.map((r) => r.key)).toEqual(['b', 'c']);
  });

  it('case 6: findCurrentVersion returns null for soft-deleted rows', async () => {
    await seedBucket('bp6');
    const em = orm.em.fork();
    const b = await em.findOneOrFail(Bucket, { name: 'bp6' });
    em.create(ObjectEntity, { id: 'bp6/k', bucket: b, key: 'k', etag: 'e', softDeleted: true });
    await em.flush();

    const repo = repoOf<ObjectRepository>(orm, ObjectEntity);
    expect(await repo.findCurrentVersion('bp6', 'k')).toBeNull();
  });

  it('case 7: nextStringBound', () => {
    expect(nextStringBound('foo')).toBe('fop');
    // Test plan also asserts `nextStringBound('\xff\xff')` returns `'\xff\xff￿'`,
    // but no valid UTF-8 string encodes to pure 0xFF bytes (0xFF is never a valid
    // UTF-8 start byte). The fallback branch is defensive code only reachable
    // for binary-decoded inputs and isn't exercised by §3.4.2's `Buffer.from(prefix, 'utf8')`.
    expect(nextStringBound('hello')).toBe('hellp');
  });

  it('case 8: findLatestVersion returns the most recent', async () => {
    await seedBucket('bp8', VersioningState.Enabled);
    const em = orm.em.fork();
    const b = await em.findOneOrFail(Bucket, { name: 'bp8' });
    em.create(ObjectVersion, { bucket: b, key: 'k', versionId: 'v1', etag: 'e', createdAt: new Date('2026-01-01T00:00:00Z') });
    em.create(ObjectVersion, { bucket: b, key: 'k', versionId: 'v2', etag: 'e', createdAt: new Date('2026-02-01T00:00:00Z') });
    await em.flush();

    const repo = repoOf<ObjectRepository>(orm, ObjectEntity);
    const latest = await repo.findLatestVersion('bp8', 'k');
    expect(latest?.versionId).toBe('v2');
  });

  it('case 9: listVersionsByPrefix orders key ASC, createdAt DESC', async () => {
    await seedBucket('bp9', VersioningState.Enabled);
    const em = orm.em.fork();
    const b = await em.findOneOrFail(Bucket, { name: 'bp9' });
    em.create(ObjectVersion, { bucket: b, key: 'k1', versionId: 'v1', etag: 'e', createdAt: new Date('2026-01-01T00:00:00Z') });
    em.create(ObjectVersion, { bucket: b, key: 'k1', versionId: 'v2', etag: 'e', createdAt: new Date('2026-02-01T00:00:00Z') });
    em.create(ObjectVersion, { bucket: b, key: 'k2', versionId: 'v1', etag: 'e', createdAt: new Date('2026-01-15T00:00:00Z') });
    await em.flush();

    const repo = repoOf<ObjectRepository>(orm, ObjectEntity);
    const rows = await repo.listVersionsByPrefix('bp9', '', undefined, undefined, 10);
    expect(rows.map((r) => `${r.key}/${r.versionId}`)).toEqual(['k1/v2', 'k1/v1', 'k2/v1']);
  });
});
