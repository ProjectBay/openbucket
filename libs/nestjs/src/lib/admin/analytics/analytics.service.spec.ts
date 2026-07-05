import { MikroORM, EntityManager } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { v7 as uuidv7 } from 'uuid';

import { UsageSample } from '../../persistence/entities/usage-sample.entity';
import { RequestMetricSample } from '../../persistence/entities/request-metric-sample.entity';
import type { BucketService } from '../../domain/buckets/bucket.service';
import type { Clock } from '../../common/clock/clock';
import { AnalyticsService, downsample, parseSampledAt } from './analytics.service';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe('analytics helpers (TEST-1102 case 6)', () => {
  it('downsample keeps <= max and preserves the first element', () => {
    const rows = Array.from({ length: 2_000 }, (_, i) => i);
    const out = downsample(rows, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out[0]).toBe(0);
  });

  it('downsample returns the array unchanged when already small', () => {
    expect(downsample([1, 2, 3], 500)).toEqual([1, 2, 3]);
  });

  it('parseSampledAt treats a space-separated SQLite datetime as UTC', () => {
    expect(parseSampledAt('2026-07-05 12:00:00').toISOString()).toBe('2026-07-05T12:00:00.000Z');
    const d = new Date(NOW);
    expect(parseSampledAt(d)).toBe(d);
  });
});

/** TEST-1102 (cases 6–7) — AnalyticsService against seeded sample tables. */
describe('AnalyticsService (TEST-1102)', () => {
  let orm: MikroORM;
  let svc: AnalyticsService;
  let existingBuckets: string[];

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [UsageSample, RequestMetricSample],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
    });
    await orm.schema.createSchema();

    // Two ticks 15m apart, two buckets (b1, b2) plus a since-deleted bucket 'gone'
    // present only in the samples.
    const em = orm.em.fork();
    const t0 = new Date(NOW - 15 * MIN);
    const t1 = new Date(NOW);
    const usage = (bucket: string, at: Date, size: number, count: number) =>
      em.create(UsageSample, {
        id: uuidv7(),
        bucketName: bucket,
        sampledAt: at,
        sizeBytes: BigInt(size),
        objectCount: count,
      });
    usage('b1', t0, 100, 1);
    usage('b2', t0, 300, 3);
    usage('b1', t1, 150, 1);
    usage('b2', t1, 350, 3);
    usage('gone', t1, 999, 9); // deleted bucket → excluded from breakdown
    const req = (surface: 'admin' | 's3', at: Date, rc: number, ec: number) =>
      em.create(RequestMetricSample, {
        id: uuidv7(),
        sampledAt: at,
        surface,
        windowMs: 900_000,
        requestCount: rc,
        errorCount: ec,
      });
    req('admin', t0, 10, 1);
    req('s3', t0, 20, 2);
    req('admin', t1, 30, 0);
    req('s3', t1, 40, 4);
    await em.flush();

    existingBuckets = ['b1', 'b2']; // 'gone' deliberately absent
    const buckets = {
      list: async () => existingBuckets.map((name) => ({ name })),
    } as unknown as BucketService;
    const clock = { nowMs: () => NOW } as unknown as Clock;
    svc = new AnalyticsService(orm.em as EntityManager, buckets, clock);
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  it('storageSeries (instance) sums across buckets per timestamp', async () => {
    const res = await svc.storageSeries('24h');
    expect(res.bucket).toBeNull();
    expect(res.points).toHaveLength(2);
    // t0 sums b1+b2+gone (all rows counted for the instance total): 100+300 = 400,
    // t1: 150+350+999 = 1499.
    expect(res.points[0].sizeBytes).toBe(400);
    expect(res.points[1].sizeBytes).toBe(1499);
    // Sorted ascending by t.
    expect(res.points[0].t < res.points[1].t).toBe(true);
  });

  it('storageSeries (per-bucket) uses exact bucket match', async () => {
    const res = await svc.storageSeries('24h', 'b1');
    expect(res.bucket).toBe('b1');
    expect(res.points.map((p) => p.sizeBytes)).toEqual([100, 150]);
  });

  it('storageSeries respects the range window', async () => {
    // 1h window still covers both ticks (15m apart); use a fake older tick check
    // by requesting the narrowest range and asserting both are within it.
    const res = await svc.storageSeries('1h', 'b2');
    expect(res.points.map((p) => p.sizeBytes)).toEqual([300, 350]);
  });

  it('bucketBreakdown uses the latest tick and excludes deleted buckets', async () => {
    const res = await svc.bucketBreakdown();
    const names = res.buckets.map((b) => b.name);
    expect(names).toContain('b1');
    expect(names).toContain('b2');
    expect(names).not.toContain('gone');
    // Totals from the latest tick over still-existing buckets: 150 + 350 = 500.
    expect(res.totalSizeBytes).toBe(500);
    expect(res.totalObjectCount).toBe(4);
    const share = res.buckets.reduce((s, b) => s + b.sharePct, 0);
    expect(Math.round(share)).toBe(100);
  });

  it('requestSeries pivots the two surfaces per timestamp', async () => {
    const res = await svc.requestSeries('24h');
    expect(res.points).toHaveLength(2);
    const [p0, p1] = res.points;
    expect(p0.admin).toEqual({ requestCount: 10, errorCount: 1 });
    expect(p0.s3).toEqual({ requestCount: 20, errorCount: 2 });
    expect(p1.admin).toEqual({ requestCount: 30, errorCount: 0 });
    expect(p1.s3).toEqual({ requestCount: 40, errorCount: 4 });
  });

  it('empty state: no samples → empty arrays, not an error', async () => {
    const empty = orm.em.fork();
    await empty.nativeDelete(UsageSample, {});
    await empty.nativeDelete(RequestMetricSample, {});
    expect((await svc.storageSeries('7d')).points).toEqual([]);
    expect((await svc.bucketBreakdown()).buckets).toEqual([]);
    expect((await svc.requestSeries('7d')).points).toEqual([]);
  });
});
