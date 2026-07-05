import { Injectable } from '@nestjs/common';
import { raw } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import {
  RequestMetricSample,
  UsageSample,
  type RequestSurface,
} from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { BucketService } from '../../domain/buckets/bucket.service';
import { Clock } from '../../common/clock/clock';

import { AnalyticsRange } from './dto/analytics-query.dto';
import { StorageSeriesDto } from './dto/storage-series.dto';
import { BucketBreakdownDto } from './dto/bucket-breakdown.dto';
import { RequestSeriesDto } from './dto/request-series.dto';

/** Upper bound on points returned to the browser (bandwidth/DoS guard). */
export const MAX_POINTS = 500;

/** Window length in ms for each allow-listed range. */
const RANGE_MS: Record<AnalyticsRange, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
  '90d': 7_776_000_000,
};

/**
 * Read-only analytics over the rolled-up sample tables (§STORY-1102, TASK-3323).
 * All series are server-side downsampled to `<= MAX_POINTS` so a 90-day window
 * never streams thousands of points. All filters are exact-equality or bound
 * range scans on indexed `sampledAt` — no LIKE, no free-form window.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly buckets: BucketService,
    private readonly clock: Clock,
  ) {}

  /**
   * Storage-over-time. Scoped to one `bucket` (exact match) or, when absent,
   * summed across all buckets per `sampledAt` for the instance total.
   */
  async storageSeries(range: AnalyticsRange, bucket?: string): Promise<StorageSeriesDto> {
    const since = new Date(this.clock.nowMs() - RANGE_MS[range]);

    if (bucket !== undefined) {
      const rows = await this.em.find(
        UsageSample,
        { bucketName: bucket, sampledAt: { $gte: since } },
        { orderBy: { sampledAt: 'ASC' } },
      );
      const points = downsample(
        rows.map((r) => ({
          t: r.sampledAt.toISOString(),
          sizeBytes: Number(r.sizeBytes),
          objectCount: r.objectCount,
        })),
      );
      return { points, bucket };
    }

    // Instance total: sum across buckets per timestamp in SQL (one row per tick).
    const grouped = (await this.em
      .createQueryBuilder(UsageSample, 'u')
      .select([
        raw('u.sampled_at as t'),
        raw('coalesce(sum(u.size_bytes), 0) as sizeBytes'),
        raw('coalesce(sum(u.object_count), 0) as objectCount'),
      ])
      .where({ sampledAt: { $gte: since } })
      .groupBy('u.sampled_at')
      .execute('all')) as { t: unknown; sizeBytes: unknown; objectCount: unknown }[];

    const points = downsample(
      grouped
        .map((r) => ({
          t: parseSampledAt(r.t).toISOString(),
          sizeBytes: Number(r.sizeBytes),
          objectCount: Number(r.objectCount),
        }))
        .sort((a, b) => a.t.localeCompare(b.t)),
    );
    return { points, bucket: null };
  }

  /**
   * Per-bucket breakdown of the MOST RECENT sample, limited to still-existing
   * buckets (a deleted bucket's stale rows are excluded). `sharePct` is each
   * bucket's fraction of the total size.
   */
  async bucketBreakdown(): Promise<BucketBreakdownDto> {
    // The latest tick's Date, taken from a managed entity so the equality filter
    // below matches the stored value exactly (no datetime string round-trip).
    // `find` (not `findOne`) with an empty filter is allowed; `limit: 1` gives the
    // single most-recent row.
    const [latest] = await this.em.find(
      UsageSample,
      {},
      { orderBy: { sampledAt: 'DESC' }, limit: 1 },
    );
    if (!latest) return { buckets: [], totalSizeBytes: 0, totalObjectCount: 0 };

    const rows = await this.em.find(UsageSample, { sampledAt: latest.sampledAt });
    const existing = new Set((await this.buckets.list()).map((b) => b.name));
    const kept = rows.filter((r) => existing.has(r.bucketName));

    const totalSizeBytes = kept.reduce((sum, r) => sum + Number(r.sizeBytes), 0);
    const totalObjectCount = kept.reduce((sum, r) => sum + r.objectCount, 0);

    const buckets = kept
      .map((r) => {
        const sizeBytes = Number(r.sizeBytes);
        return {
          name: r.bucketName,
          sizeBytes,
          objectCount: r.objectCount,
          sharePct: totalSizeBytes > 0 ? (sizeBytes / totalSizeBytes) * 100 : 0,
        };
      })
      .sort((a, b) => b.sizeBytes - a.sizeBytes);

    return { buckets, totalSizeBytes, totalObjectCount };
  }

  /** Request/error series, pivoted across the two surfaces per `sampledAt`. */
  async requestSeries(range: AnalyticsRange): Promise<RequestSeriesDto> {
    const since = new Date(this.clock.nowMs() - RANGE_MS[range]);
    const rows = await this.em.find(
      RequestMetricSample,
      { sampledAt: { $gte: since } },
      { orderBy: { sampledAt: 'ASC' } },
    );

    const byTime = new Map<
      number,
      {
        t: string;
        admin: { requestCount: number; errorCount: number };
        s3: { requestCount: number; errorCount: number };
      }
    >();
    for (const r of rows) {
      const key = r.sampledAt.getTime();
      let entry = byTime.get(key);
      if (!entry) {
        entry = {
          t: r.sampledAt.toISOString(),
          admin: { requestCount: 0, errorCount: 0 },
          s3: { requestCount: 0, errorCount: 0 },
        };
        byTime.set(key, entry);
      }
      entry[r.surface as RequestSurface] = {
        requestCount: r.requestCount,
        errorCount: r.errorCount,
      };
    }

    const points = downsample(
      [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t)),
    );
    return { points };
  }
}

/**
 * Downsample an ascending series to `<= MAX_POINTS` by keeping every
 * `ceil(n/MAX_POINTS)`-th element. `ceil(n / ceil(n/MAX_POINTS)) <= MAX_POINTS`,
 * so the cap always holds.
 */
export function downsample<T>(rows: T[], max = MAX_POINTS): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
  return out;
}

/**
 * Parse a `sampled_at` value returned by a raw SQL aggregate. MikroORM/libsql
 * stores datetimes as UTC text (`YYYY-MM-DD HH:MM:SS[.SSS]`, forceUtcTimezone);
 * a bare space-separated value is treated as UTC. Also tolerates a real `Date`
 * or an epoch number.
 */
export function parseSampledAt(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v);
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const hasZone = /[zZ]$/.test(iso) || /[+-]\d\d:?\d\d$/.test(iso);
  return new Date(hasZone ? iso : `${iso}Z`);
}
