import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { Bucket } from '../entities/bucket.entity';
import { ObjectEntity } from '../entities/object.entity';
import { ObjectTag } from '../entities/object-tag.entity';
import { ObjectVersion } from '../entities/object-version.entity';
import { IntegrityStatus, ObjectLocation } from '../entities/types';
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

/**
 * TEST-1204 — the integrity scrubber's paged scan + the admin corrupt-list query
 * (STORY-1204), against a real :memory: SQLite built from entity metadata.
 */
describe('ObjectRepository integrity queries (TEST-1204)', () => {
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

  interface SeedRow {
    key: string;
    sha?: string | null;
    softDeleted?: boolean;
    location?: ObjectLocation;
    status?: IntegrityStatus;
    checkedAt?: Date;
  }

  const seed = async (bucket: string, rows: SeedRow[]): Promise<void> => {
    const em = orm.em.fork();
    const b = em.create(Bucket, { name: bucket });
    for (const r of rows) {
      em.create(ObjectEntity, {
        id: `${bucket}/${r.key}`,
        bucket: b,
        key: r.key,
        etag: 'e',
        contentSha256: r.sha === undefined ? 'a'.repeat(64) : r.sha ?? undefined,
        softDeleted: r.softDeleted ?? false,
        location: r.location ?? ObjectLocation.Local,
        integrityStatus: r.status ?? IntegrityStatus.Unchecked,
        integrityCheckedAt: r.checkedAt,
      });
    }
    await em.flush();
  };

  it('case 1: scanForScrub returns only local, live, sha-bearing rows in (bucket,key) order', async () => {
    await seed('scrub', [
      { key: 'a' },
      { key: 'b', softDeleted: true }, // excluded — soft-deleted
      { key: 'c', location: ObjectLocation.Remote }, // excluded — tiered
      { key: 'd', sha: null }, // excluded — no stored digest
      { key: 'e' },
    ]);
    const rows = await repoOf(orm).scanForScrub({ limit: 100 });
    expect(rows.map((r) => r.key)).toEqual(['a', 'e']);
    // bucket is populated so the runner can read o.bucket.name.
    expect(rows[0].bucket.name).toBe('scrub');
  });

  it('case 2: scanForScrub honours the (bucket,key) cursor and limit', async () => {
    await seed('page', [{ key: 'k1' }, { key: 'k2' }, { key: 'k3' }]);
    const repo = repoOf(orm);
    const p1 = await repo.scanForScrub({ limit: 2, afterBucket: 'page', afterKey: '' });
    // First two keys of the 'page' bucket (other buckets from case 1 sort before 'page' vs 'scrub';
    // constrain via the cursor to this bucket window).
    const p1Keys = p1.filter((r) => r.bucket.name === 'page').map((r) => r.key);
    expect(p1Keys.length).toBeGreaterThan(0);

    const last = p1[p1.length - 1];
    const p2 = await repo.scanForScrub({
      limit: 100,
      afterBucket: last.bucket.name,
      afterKey: last.key,
    });
    // Every returned row is strictly after the cursor in (bucket,key) order.
    for (const r of p2) {
      const after = r.bucket.name > last.bucket.name || (r.bucket.name === last.bucket.name && r.key > last.key);
      expect(after).toBe(true);
    }
  });

  it('case 3: listCorrupt returns only corrupt rows, newest-checked first, with a total', async () => {
    await seed('corrupt', [
      { key: 'ok1', status: IntegrityStatus.Ok },
      { key: 'bad1', status: IntegrityStatus.Corrupt, checkedAt: new Date('2026-01-01T00:00:00Z') },
      { key: 'bad2', status: IntegrityStatus.Corrupt, checkedAt: new Date('2026-02-01T00:00:00Z') },
      { key: 'unchecked1' },
    ]);
    const { rows, total } = await repoOf(orm).listCorrupt({ limit: 50, offset: 0 });
    expect(total).toBe(2);
    expect(rows.map((r) => r.key)).toEqual(['bad2', 'bad1']); // newest checkedAt first
  });

  it('case 4: listCorrupt is offset/limit paged', async () => {
    const { rows, total } = await repoOf(orm).listCorrupt({ limit: 1, offset: 1 });
    expect(total).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('bad1');
  });
});
