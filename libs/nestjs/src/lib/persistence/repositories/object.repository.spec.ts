import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { Bucket } from '../entities/bucket.entity';
import { ObjectEntity } from '../entities/object.entity';
import { ObjectTag } from '../entities/object-tag.entity';
import { ObjectVersion } from '../entities/object-version.entity';
import { escapeLikePattern, ObjectRepository } from './object.repository';

const repoOf = (orm: MikroORM): ObjectRepository =>
  orm.em.fork().getRepository(ObjectEntity) as unknown as ObjectRepository;

/**
 * TEST-1101 (cases 1–3) — cross-bucket search repository query + LIKE-escape
 * helper (TASK-3310), plus the index-backed tag-filter join (TASK-3312), against
 * a real :memory: SQLite built from entity metadata via the SchemaGenerator.
 */
describe('ObjectRepository.searchAcrossBuckets (TEST-1101)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, ObjectEntity, ObjectTag, ObjectVersion],
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

  const seed = async (bucket: string, keys: string[]): Promise<void> => {
    const em = orm.em.fork();
    const b = em.create(Bucket, { name: bucket });
    for (const key of keys) {
      em.create(ObjectEntity, { id: `${bucket}/${key}`, bucket: b, key, etag: 'e' });
    }
    await em.flush();
  };

  // ---- escapeLikePattern (case 1) ------------------------------------------
  it('case 1: escapeLikePattern escapes the escape char first, then % and _', () => {
    expect(escapeLikePattern('a%_b\\c')).toBe('a\\%\\_b\\\\c');
    expect(escapeLikePattern('plain')).toBe('plain');
  });

  // ---- contains treats wildcards literally (case 2) ------------------------
  it('case 2: contains search for a literal "%" matches only keys with a real %', async () => {
    await seed('pct', ['has%pct', 'plainkey', 'another']);
    const page = await repoOf(orm).searchAcrossBuckets({
      term: '%',
      mode: 'contains',
      bucket: 'pct',
      limit: 100,
    });
    expect(page.rows.map((r) => r.key)).toEqual(['has%pct']);
  });

  // ---- prefix uses a range scan, not LIKE (case 3) -------------------------
  it('case 3: prefix mode is a range scan (no substring match), unlike contains', async () => {
    await seed('rng', ['log/a', 'log/b', 'catalog/x']);
    const repo = repoOf(orm);

    const prefix = await repo.searchAcrossBuckets({ term: 'log', mode: 'prefix', bucket: 'rng', limit: 100 });
    // 'catalog/x' CONTAINS 'log' but does not start with it → excluded by range scan.
    expect(prefix.rows.map((r) => r.key)).toEqual(['log/a', 'log/b']);

    const contains = await repo.searchAcrossBuckets({ term: 'log', mode: 'contains', bucket: 'rng', limit: 100 });
    expect(contains.rows.map((r) => r.key).sort()).toEqual(['catalog/x', 'log/a', 'log/b']);
  });

  // ---- truncation + keyset next page ---------------------------------------
  it('truncates at limit and the last-row cursor returns the next disjoint page', async () => {
    await seed('pg', ['k1', 'k2', 'k3']);
    const repo = repoOf(orm);

    const p1 = await repo.searchAcrossBuckets({ term: 'k', mode: 'prefix', bucket: 'pg', limit: 2 });
    expect(p1.rows.map((r) => r.key)).toEqual(['k1', 'k2']);
    expect(p1.truncated).toBe(true);

    const last = p1.rows[p1.rows.length - 1];
    const p2 = await repo.searchAcrossBuckets({
      term: 'k',
      mode: 'prefix',
      bucket: 'pg',
      cursor: { bucket: last.bucket.name, key: last.key },
      limit: 2,
    });
    expect(p2.rows.map((r) => r.key)).toEqual(['k3']);
    expect(p2.truncated).toBe(false);
  });

  // ---- cross-bucket ordering by (bucket, key) ------------------------------
  it('scans across buckets ordered by (bucket, key) when no bucket is given', async () => {
    await seed('aaa', ['shared-x']);
    await seed('bbb', ['shared-y']);
    const rows = (
      await repoOf(orm).searchAcrossBuckets({ term: 'shared', mode: 'prefix', limit: 100 })
    ).rows;
    const pairs = rows.map((r) => `${r.bucket.name}/${r.key}`);
    expect(pairs).toContain('aaa/shared-x');
    expect(pairs).toContain('bbb/shared-y');
    // aaa sorts before bbb.
    expect(pairs.indexOf('aaa/shared-x')).toBeLessThan(pairs.indexOf('bbb/shared-y'));
  });

  // ---- index-backed tag filter join (TASK-3312) ----------------------------
  it('tag filter returns only objects carrying that exact (key,value), across buckets', async () => {
    const em = orm.em.fork();
    const b1 = em.create(Bucket, { name: 'tag1' });
    const b2 = em.create(Bucket, { name: 'tag2' });
    const prod1 = em.create(ObjectEntity, { id: 'tag1/prod', bucket: b1, key: 'prod', etag: 'e' });
    const dev1 = em.create(ObjectEntity, { id: 'tag1/dev', bucket: b1, key: 'dev', etag: 'e' });
    const prod2 = em.create(ObjectEntity, { id: 'tag2/prod', bucket: b2, key: 'prod', etag: 'e' });
    em.create(ObjectTag, { id: 't1', object: prod1, bucket: b1, tagKey: 'env', tagValue: 'prod' });
    em.create(ObjectTag, { id: 't2', object: dev1, bucket: b1, tagKey: 'env', tagValue: 'dev' });
    em.create(ObjectTag, { id: 't3', object: prod2, bucket: b2, tagKey: 'env', tagValue: 'prod' });
    await em.flush();

    const rows = (
      await repoOf(orm).searchAcrossBuckets({
        term: '',
        mode: 'prefix',
        tagKey: 'env',
        tagValue: 'prod',
        limit: 100,
      })
    ).rows;
    expect(rows.map((r) => `${r.bucket.name}/${r.key}`).sort()).toEqual(['tag1/prod', 'tag2/prod']);
  });
});
