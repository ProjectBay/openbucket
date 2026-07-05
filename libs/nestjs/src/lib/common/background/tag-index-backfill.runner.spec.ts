import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/libsql';

import { Bucket, ObjectEntity, ObjectTag, ObjectVersion } from '../../persistence/index';
import { TagIndexBackfillRunner } from './tag-index-backfill.runner';

/**
 * TEST-1101 — tag-index backfill runner (TASK-3312). Populates object_tags rows
 * for objects whose tags predate the table, is a no-op once caught up, and never
 * requeues empty tag sets.
 */
describe('TagIndexBackfillRunner (TEST-1101)', () => {
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

  it('backfills rows for pre-existing tagged objects and is a no-op once caught up', async () => {
    const em = orm.em.fork();
    const b = em.create(Bucket, { name: 'bf' });
    // Two objects with tags written straight to the JSON column (no index rows),
    // one untagged, and one with an empty tag set (must never requeue).
    em.create(ObjectEntity, { id: 'bf/a', bucket: b, key: 'a', etag: 'e', tagging: { env: 'prod', k: 'v' } });
    em.create(ObjectEntity, { id: 'bf/b', bucket: b, key: 'b', etag: 'e', tagging: { team: 'infra' } });
    em.create(ObjectEntity, { id: 'bf/c', bucket: b, key: 'c', etag: 'e' });
    em.create(ObjectEntity, { id: 'bf/d', bucket: b, key: 'd', etag: 'e', tagging: {} });
    await em.flush();

    const runner = new TagIndexBackfillRunner(orm.em as unknown as EntityManager);
    await runner.run();

    const q = orm.em.fork();
    expect(await q.count(ObjectTag, { object: 'bf/a' })).toBe(2);
    expect(await q.count(ObjectTag, { object: 'bf/b' })).toBe(1);
    expect(await q.count(ObjectTag, { object: 'bf/c' })).toBe(0);
    expect(await q.count(ObjectTag, { object: 'bf/d' })).toBe(0); // empty set → skipped
    const total = await q.count(ObjectTag, {});
    expect(total).toBe(3);

    // Second run is a no-op — the index is caught up (no duplicate rows).
    await new TagIndexBackfillRunner(orm.em as unknown as EntityManager).run();
    expect(await orm.em.fork().count(ObjectTag, {})).toBe(3);
  });
});
