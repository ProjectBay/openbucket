import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { v7 as uuidv7 } from 'uuid';

import {
  ObjectRepository,
  RequestMetricSample,
  UsageSample,
} from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { BucketService } from '../../domain/buckets/bucket.service';

import { AppConfigService } from '../config/app-config.service';
import { Clock } from '../clock/clock';
import { RequestMetricsService, Surface } from '../metrics/request-metrics.service';
import { ScheduledTask } from './background.service';

const MS_PER_DAY = 86_400_000;
const SURFACES: readonly Surface[] = ['admin', 's3'];

/**
 * Usage-rollup tick (STORY-1102, TASK-3322). Every
 * `AppConfigService.usageRollupIntervalMs` (default 15 min) it:
 *   1. snapshots per-bucket storage via one grouped aggregate
 *      ({@link ObjectRepository.aggregateByBucket}) + seeds empty buckets as 0/0,
 *   2. drains the in-memory request-metrics accumulators,
 *   3. writes both sets of samples with a single shared `sampledAt`,
 *   4. prunes rows older than `usageRetentionDays` (bounds table growth).
 *
 * Best-effort telemetry: a crash between drain and commit loses at most one
 * window (acceptable, unlike durability-critical object writes). Reads the Clock
 * so tests can fast-forward retention.
 */
@Injectable()
export class UsageRollupRunner implements ScheduledTask {
  readonly name = 'usage-rollup';
  private readonly log = new Logger(UsageRollupRunner.name);

  /** Config-driven; the scheduler snapshots this into its `setInterval` at boot. */
  get intervalMs(): number {
    return this.config.usageRollupIntervalMs;
  }

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly buckets: BucketService,
    private readonly objects: ObjectRepository,
    private readonly metrics: RequestMetricsService,
    private readonly config: AppConfigService,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const sampledAt = new Date(this.clock.nowMs());
    const cutoff = new Date(this.clock.nowMs() - this.config.usageRetentionDays * MS_PER_DAY);

    // One grouped aggregate for every bucket with live objects…
    const agg = new Map(
      (await this.objects.aggregateByBucket()).map((r) => [
        r.bucket,
        { objectCount: r.objectCount, sizeBytes: BigInt(r.sizeBytes) },
      ]),
    );
    // …then the full bucket list so empty buckets still record a 0/0 sample.
    const allBuckets = await this.buckets.list();
    const drained = this.metrics.drain();

    await this.em.transactional(async (em) => {
      for (const b of allBuckets) {
        const s = agg.get(b.name) ?? { objectCount: 0, sizeBytes: 0n };
        em.create(UsageSample, {
          id: uuidv7(),
          bucketName: b.name,
          sampledAt,
          objectCount: s.objectCount,
          sizeBytes: s.sizeBytes,
        });
      }
      for (const surface of SURFACES) {
        em.create(RequestMetricSample, {
          id: uuidv7(),
          sampledAt,
          surface,
          windowMs: this.intervalMs,
          requestCount: drained[surface].requestCount,
          errorCount: drained[surface].errorCount,
        });
      }
      // Retention prune (set-based, no row hydration) — the sole growth bound.
      await em.nativeDelete(UsageSample, { sampledAt: { $lt: cutoff } });
      await em.nativeDelete(RequestMetricSample, { sampledAt: { $lt: cutoff } });
    });

    this.log.debug(
      `usage-rollup: sampled ${allBuckets.length} bucket(s) + ${SURFACES.length} surface(s) @ ${sampledAt.toISOString()}`,
    );
  }
}
