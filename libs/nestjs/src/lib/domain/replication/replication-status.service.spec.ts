import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { v7 as uuidv7 } from 'uuid';

import { Bucket, ReplicationOutbox } from '../../persistence/index';
import type { Clock } from '../../common/clock/clock';
import type { ReplicationConfig } from '../../storage/replication/replication-config';
import { ReplicationStatusService } from './replication-status.service';

/**
 * TEST-0902 — ReplicationStatusService aggregation. Real in-memory ORM (schema
 * from entity metadata) so the GROUP-BY aggregates run against SQLite.
 */
const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const clock: Clock = { nowMs: () => NOW, now: () => new Date(NOW) } as Clock;

function makeConfig(over: Partial<ReplicationConfig> = {}): ReplicationConfig {
  return {
    enabled: true,
    endpoint: 'https://secret-endpoint.example.com',
    region: 'us-east-1',
    bucket: 'remote-secret-bucket',
    accessKeyId: 'AKIA-SECRET',
    secretAccessKey: 'SK-SECRET',
    forcePathStyle: true,
    maxAttempts: 12,
    drainIntervalMs: 5_000,
    batchKeys: 50,
    largeObjectThresholdBytes: 64 * 1024 * 1024,
    ...over,
  };
}

describe('ReplicationStatusService (TEST-0902)', () => {
  let orm: MikroORM;
  let seq = 0n;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, ReplicationOutbox],
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

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    seq = 0n;
  });

  async function seedBucket(name: string): Promise<void> {
    const em = orm.em.fork();
    em.create(Bucket, { name });
    await em.flush();
  }

  async function seed(row: {
    bucket: string;
    key: string;
    status: 'pending' | 'failed' | 'done';
    attempts?: number;
    ageMs?: number;
    lastError?: string;
  }): Promise<void> {
    const em = orm.em.fork();
    const created = new Date(NOW - (row.ageMs ?? 0));
    em.create(ReplicationOutbox, {
      id: uuidv7(),
      seq: seq++,
      bucket: em.getReference(Bucket, row.bucket as unknown as Bucket),
      key: row.key,
      op: 'PUT',
      status: row.status,
      attempts: row.attempts ?? 0,
      nextAttemptAt: created,
      lastError: row.lastError,
      createdAt: created,
      updatedAt: created,
    });
    await em.flush();
  }

  it('case: empty/unconfigured instance → enabled:false, all-zero counters, no throw', async () => {
    const svc = new ReplicationStatusService(orm.em as never, makeConfig({ enabled: false }), clock);
    const status = await svc.getStatus();
    expect(status).toEqual({
      enabled: false,
      pendingCount: 0,
      inflightCount: 0,
      failedCount: 0,
      oldestPendingAgeMs: null,
      lastError: null,
      perBucket: [],
    });
  });

  it('case: counts split pending (fresh) vs inflight (retrying) vs failed, per bucket', async () => {
    await seedBucket('a');
    await seedBucket('b');
    await seed({ bucket: 'a', key: 'k1', status: 'pending', attempts: 0, ageMs: 60_000 });
    await seed({ bucket: 'a', key: 'k2', status: 'pending', attempts: 3, ageMs: 30_000 });
    await seed({ bucket: 'a', key: 'k3', status: 'failed', attempts: 12 });
    await seed({ bucket: 'b', key: 'k4', status: 'pending', attempts: 0, ageMs: 10_000 });
    await seed({ bucket: 'b', key: 'k5', status: 'done' }); // ignored

    const svc = new ReplicationStatusService(orm.em as never, makeConfig(), clock);
    const status = await svc.getStatus();

    expect(status.enabled).toBe(true);
    expect(status.pendingCount).toBe(2); // a:k1 + b:k4 (attempts 0)
    expect(status.inflightCount).toBe(1); // a:k2 (attempts>0)
    expect(status.failedCount).toBe(1); // a:k3
    expect(status.oldestPendingAgeMs).toBe(60_000); // oldest pending overall

    const a = status.perBucket.find((x) => x.bucket === 'a')!;
    expect(a).toMatchObject({ pendingCount: 1, inflightCount: 1, failedCount: 1, oldestPendingAgeMs: 60_000 });
    const b = status.perBucket.find((x) => x.bucket === 'b')!;
    expect(b).toMatchObject({ pendingCount: 1, inflightCount: 0, failedCount: 0, oldestPendingAgeMs: 10_000 });
  });

  it('case: lastError projects only the outbox row fields — never the target config', async () => {
    await seedBucket('a');
    await seed({ bucket: 'a', key: 'boom', status: 'failed', attempts: 12, lastError: 'AccessDenied on key' });

    const svc = new ReplicationStatusService(orm.em as never, makeConfig(), clock);
    const status = await svc.getStatus();

    expect(status.lastError).not.toBeNull();
    expect(status.lastError!.message).toBe('AccessDenied on key');
    expect(status.lastError!.bucket).toBe('a');
    expect(status.lastError!.key).toBe('boom');
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('secret-endpoint');
    expect(serialized).not.toContain('remote-secret-bucket');
    expect(serialized).not.toContain('AKIA-SECRET');
  });

  it('case: counts come from GROUP-BY aggregates, not row materialization', async () => {
    await seedBucket('a');
    for (let i = 0; i < 200; i++) {
      await seed({ bucket: 'a', key: `k${i}`, status: 'pending', ageMs: 1000 });
    }
    const em = orm.em.fork();
    const findSpy = jest.spyOn(em, 'find');
    const svc = new ReplicationStatusService(em as never, makeConfig(), clock);
    const status = await svc.getStatus();

    expect(status.pendingCount).toBe(200);
    expect(findSpy).not.toHaveBeenCalled(); // never loaded the rows
  });

  it('case: getBucketStatus zeroes a bucket with no outbox rows', async () => {
    await seedBucket('empty');
    const svc = new ReplicationStatusService(orm.em as never, makeConfig(), clock);
    const status = await svc.getBucketStatus('empty');
    expect(status).toEqual({
      bucket: 'empty',
      pendingCount: 0,
      inflightCount: 0,
      failedCount: 0,
      oldestPendingAgeMs: null,
    });
  });
});
