import { MikroORM, EntityManager } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { Bucket } from '../../persistence/entities/bucket.entity';
import { ObjectEntity } from '../../persistence/entities/object.entity';
import { ObjectTag } from '../../persistence/entities/object-tag.entity';
import { ObjectVersion } from '../../persistence/entities/object-version.entity';
import { UsageSample } from '../../persistence/entities/usage-sample.entity';
import { RequestMetricSample } from '../../persistence/entities/request-metric-sample.entity';
import { ObjectRepository } from '../../persistence/repositories/object.repository';
import type { BucketService } from '../../domain/buckets/bucket.service';
import type { ReplicationStatusService } from '../../domain/replication/replication-status.service';
import type { ReplicationConfig } from '../../storage/replication/replication-config';
import type { AppConfigService } from '../config/app-config.service';
import type { Clock } from '../clock/clock';
import { RequestMetricsService } from '../metrics/request-metrics.service';
import { buildPromMetrics, type PromMetrics } from '../metrics/metrics.registry';
import { UsageRollupRunner } from './usage-rollup.runner';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/** Read a per-`bucket` gauge into a plain `{ bucket: value }` map. */
async function gaugeMap(gauge: PromMetrics['storageBytes']): Promise<Record<string, number>> {
  const { values } = await gauge.get();
  const out: Record<string, number> = {};
  for (const v of values) out[String(v.labels.bucket)] = v.value;
  return out;
}

/** Read a per-`status` gauge into a plain `{ status: value }` map. */
async function statusMap(
  gauge: PromMetrics['replicationOutboxDepth'],
): Promise<Record<string, number>> {
  const { values } = await gauge.get();
  const out: Record<string, number> = {};
  for (const v of values) out[String(v.labels.status)] = v.value;
  return out;
}

/** TEST-1102 / TEST-1202 — aggregateByBucket + UsageRollupRunner (samples + gauges). */
describe('UsageRollupRunner (TEST-1102 / TEST-1202)', () => {
  let orm: MikroORM;
  let metrics: RequestMetricsService;
  let prom: PromMetrics;
  let clockNow: number;
  let runner: UsageRollupRunner;
  let bucketNames: string[];
  let replicationEnabled: boolean;
  let getStatusCalls: number;

  const repo = (): ObjectRepository =>
    orm.em.fork().getRepository(ObjectEntity) as unknown as ObjectRepository;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, ObjectEntity, ObjectTag, ObjectVersion, UsageSample, RequestMetricSample],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
      pool: {
        afterCreate: (conn: { pragma: (s: string) => void }, done: () => void) => {
          conn.pragma('foreign_keys = ON');
          done();
        },
      },
    });
    await orm.schema.createSchema();

    // Seed: b1 has two live objects (sizes 100 + 200), empty1 has none.
    const seed = orm.em.fork();
    const b1 = seed.create(Bucket, { name: 'b1' });
    seed.create(Bucket, { name: 'empty1' });
    seed.create(ObjectEntity, { id: 'o1', bucket: b1, key: 'a', etag: 'e', size: 100n });
    seed.create(ObjectEntity, { id: 'o2', bucket: b1, key: 'b', etag: 'e', size: 200n });
    await seed.flush();

    metrics = new RequestMetricsService();
    prom = buildPromMetrics();
    clockNow = NOW;
    bucketNames = ['b1', 'empty1'];
    replicationEnabled = false;
    getStatusCalls = 0;

    const clock = { nowMs: () => clockNow } as unknown as Clock;
    const config = { usageRollupIntervalMs: 900_000, usageRetentionDays: 90 } as AppConfigService;
    const buckets = {
      list: async () => bucketNames.map((name) => ({ name })),
    } as unknown as BucketService;
    const replicationConfig = {
      get enabled() {
        return replicationEnabled;
      },
    } as ReplicationConfig;
    const replicationStatus = {
      getStatus: async () => {
        getStatusCalls += 1;
        return { pendingCount: 3, inflightCount: 2, failedCount: 1 };
      },
    } as unknown as ReplicationStatusService;
    const integrityStatus = {
      getStatus: async () => ({
        enabled: false,
        scanned: 0,
        ok: 0,
        corrupt: 0,
        unchecked: 0,
        repaired: 0,
        lastRunAt: null,
        cursor: null,
      }),
    } as unknown as import('../../domain/integrity/integrity-status.service').IntegrityStatusService;

    runner = new UsageRollupRunner(
      orm.em as EntityManager,
      buckets,
      repo(),
      metrics,
      config,
      clock,
      prom,
      replicationStatus,
      replicationConfig,
      integrityStatus,
    );
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  it('aggregateByBucket returns count+size for buckets with live objects', async () => {
    const rows = await repo().aggregateByBucket();
    const b1 = rows.find((r) => r.bucket === 'b1');
    expect(b1).toEqual({ bucket: 'b1', objectCount: 2, sizeBytes: 300 });
    // Empty bucket has no live objects → no aggregate row.
    expect(rows.find((r) => r.bucket === 'empty1')).toBeUndefined();
  });

  it('run() writes one usage sample per bucket (incl. empty as 0/0) + one metric row per surface', async () => {
    metrics.record('s3', 200);
    metrics.record('s3', 500);
    metrics.record('admin', 200);

    await runner.run();

    const em = orm.em.fork();
    const usage = await em.find(UsageSample, {}, { orderBy: { bucketName: 'ASC' } });
    expect(usage).toHaveLength(2);
    const b1 = usage.find((u) => u.bucketName === 'b1')!;
    expect(b1.objectCount).toBe(2);
    expect(Number(b1.sizeBytes)).toBe(300);
    const empty = usage.find((u) => u.bucketName === 'empty1')!;
    expect(empty.objectCount).toBe(0);
    expect(Number(empty.sizeBytes)).toBe(0);
    // Shared sampledAt across the tick.
    expect(b1.sampledAt.getTime()).toBe(empty.sampledAt.getTime());

    const reqs = await em.find(RequestMetricSample, {}, { orderBy: { surface: 'ASC' } });
    expect(reqs).toHaveLength(2);
    const s3 = reqs.find((r) => r.surface === 's3')!;
    expect(s3.requestCount).toBe(2);
    expect(s3.errorCount).toBe(1);
    expect(s3.windowMs).toBe(900_000);
    const admin = reqs.find((r) => r.surface === 'admin')!;
    expect(admin.requestCount).toBe(1);

    // drain() was consumed — a fresh drain is zeros.
    expect(metrics.drain()).toEqual({
      admin: { requestCount: 0, errorCount: 0 },
      s3: { requestCount: 0, errorCount: 0 },
    });
  });

  it('run() sets the storage/object-count gauges from the same tick data', async () => {
    // (gauge state carried from the previous run() — same seed numbers)
    expect(await gaugeMap(prom.storageBytes)).toEqual({ b1: 300, empty1: 0 });
    expect(await gaugeMap(prom.objectCount)).toEqual({ b1: 2, empty1: 0 });
  });

  it('replication disabled → depth gauges all zero and no status query issued', async () => {
    expect(await statusMap(prom.replicationOutboxDepth)).toEqual({
      pending: 0,
      inflight: 0,
      failed: 0,
    });
    expect(getStatusCalls).toBe(0);
  });

  it('deleting a bucket and running a tick evicts its gauge series (reconcileGauge)', async () => {
    // Drop empty1 from the live bucket list and re-run.
    bucketNames = ['b1'];
    await runner.run();

    const storage = await gaugeMap(prom.storageBytes);
    const counts = await gaugeMap(prom.objectCount);
    expect(storage).toEqual({ b1: 300 });
    expect(counts).toEqual({ b1: 2 });
    expect(storage).not.toHaveProperty('empty1');
    expect(counts).not.toHaveProperty('empty1');
  });

  it('replication enabled → depth gauges reflect getStatus counts', async () => {
    replicationEnabled = true;
    await runner.run();

    expect(await statusMap(prom.replicationOutboxDepth)).toEqual({
      pending: 3,
      inflight: 2,
      failed: 1,
    });
    expect(getStatusCalls).toBe(1);
  });

  it('a later run() past the retention window prunes the earlier batch', async () => {
    // Advance the clock 91 days (> 90d retention) and run again.
    clockNow = NOW + 91 * DAY;
    await runner.run();

    const em = orm.em.fork();
    const usage = await em.find(UsageSample, {}, { orderBy: { sampledAt: 'ASC' } });
    // Only the new tick's row remains (bucketNames is now just b1); earlier pruned.
    expect(usage).toHaveLength(1);
    for (const u of usage) expect(u.sampledAt.getTime()).toBe(clockNow);

    const reqs = await em.find(RequestMetricSample, {});
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.sampledAt.getTime()).toBe(clockNow);
  });
});
