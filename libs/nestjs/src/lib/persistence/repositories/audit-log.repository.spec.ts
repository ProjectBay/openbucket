import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { v7 as uuidv7 } from 'uuid';

import { AuditLog } from '../entities/audit-log.entity';
import { AuditLogRepository, type AuditRow } from './audit-log.repository';

const repoOf = (orm: MikroORM): AuditLogRepository =>
  orm.em.fork().getRepository(AuditLog) as unknown as AuditLogRepository;

const row = (over: Partial<AuditRow> & { ts: Date; event: string }): AuditRow => ({
  id: uuidv7(),
  subject: null,
  requestId: null,
  bucket: null,
  objectKey: null,
  keyId: null,
  ip: null,
  detail: null,
  ...over,
});

/**
 * TEST-1103 — AuditLogRepository (TASK-3330) against a real :memory: SQLite
 * built from entity metadata: batch insert, newest-first keyset query, and the
 * retention prune.
 */
describe('AuditLogRepository (TEST-1103)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [AuditLog],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
    });
    await orm.schema.createSchema();
  }, 60_000);

  afterEach(async () => {
    await orm.em.fork().nativeDelete(AuditLog, {});
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('case 1: insertMany persists a batch in one flush and returns the ids', async () => {
    const rows = [
      row({ ts: new Date('2026-01-01T00:00:00Z'), event: 'bucket.created', bucket: 'b1' }),
      row({ ts: new Date('2026-01-01T00:00:01Z'), event: 'key.created', keyId: 'AKIA' }),
    ];
    const ids = await repoOf(orm).insertMany(rows);
    expect(ids).toHaveLength(2);
    const all = await orm.em.fork().find(AuditLog, {});
    expect(all).toHaveLength(2);
  });

  it('case 2: insertMany of an empty batch is a no-op', async () => {
    const ids = await repoOf(orm).insertMany([]);
    expect(ids).toEqual([]);
  });

  it('case 3: query returns rows newest-first and honours the (ts,id) cursor', async () => {
    const base = Date.parse('2026-03-01T00:00:00Z');
    const rows: AuditRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(row({ ts: new Date(base + i * 1000), event: 'e', subject: `s${i}` }));
    }
    await repoOf(orm).insertMany(rows);

    // Page 1: newest 2 (+1 sentinel) → i=4, i=3.
    const page1 = await repoOf(orm).query({ limit: 2 });
    expect(page1).toHaveLength(3); // limit + 1
    expect(page1.slice(0, 2).map((r) => r.subject)).toEqual(['s4', 's3']);

    // Page 2 from the cursor at the 2nd row (i=3): next are i=2, i=1.
    const cursor = page1[1];
    const page2 = await repoOf(orm).query({
      limit: 2,
      before: { ts: cursor.ts, id: cursor.id },
    });
    expect(page2.slice(0, 2).map((r) => r.subject)).toEqual(['s2', 's1']);
  });

  it('case 4: query filters exact event/subject/bucket and the ts range', async () => {
    await repoOf(orm).insertMany([
      row({ ts: new Date('2026-05-01T00:00:00Z'), event: 'bucket.created', bucket: 'b1' }),
      row({ ts: new Date('2026-05-02T00:00:00Z'), event: 'bucket.deleted', bucket: 'b1' }),
      row({ ts: new Date('2026-05-03T00:00:00Z'), event: 'bucket.created', bucket: 'b2' }),
    ]);

    const byEvent = await repoOf(orm).query({ event: 'bucket.created', limit: 50 });
    expect(byEvent.map((r) => r.bucket).sort()).toEqual(['b1', 'b2']);

    const byBucket = await repoOf(orm).query({ bucket: 'b1', limit: 50 });
    expect(byBucket).toHaveLength(2);

    const inRange = await repoOf(orm).query({
      from: new Date('2026-05-02T00:00:00Z'),
      to: new Date('2026-05-02T23:59:59Z'),
      limit: 50,
    });
    expect(inRange.map((r) => r.event)).toEqual(['bucket.deleted']);
  });

  it('case 5: pruneOlderThan deletes only rows before the cutoff and returns the count', async () => {
    await repoOf(orm).insertMany([
      row({ ts: new Date('2026-01-01T00:00:00Z'), event: 'old' }),
      row({ ts: new Date('2026-06-01T00:00:00Z'), event: 'new' }),
    ]);
    const removed = await repoOf(orm).pruneOlderThan(new Date('2026-03-01T00:00:00Z'));
    expect(removed).toBe(1);
    const remaining = await orm.em.fork().find(AuditLog, {});
    expect(remaining.map((r) => r.event)).toEqual(['new']);
  });
});
