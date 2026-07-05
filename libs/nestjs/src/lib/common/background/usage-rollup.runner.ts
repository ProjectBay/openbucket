import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { ReplicationStatusService } from '../../domain/replication/replication-status.service';
import { IntegrityStatusService } from '../../domain/integrity/integrity-status.service';
import {
  REPLICATION_CONFIG,
  type ReplicationConfig,
} from '../../storage/replication/replication-config';

import { AppConfigService } from '../config/app-config.service';
import { Clock } from '../clock/clock';
import { RequestMetricsService, Surface } from '../metrics/request-metrics.service';
import { PROM_METRICS, type PromMetrics } from '../metrics/metrics.registry';
import { reconcileGauge } from '../metrics/gauge-refresher';
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
    @Inject(PROM_METRICS) private readonly prom: PromMetrics,
    private readonly replicationStatus: ReplicationStatusService,
    @Inject(REPLICATION_CONFIG) private readonly replicationConfig: ReplicationConfig,
    private readonly integrityStatus: IntegrityStatusService,
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

    // Prometheus gauges (STORY-1202): refresh from the SAME in-memory aggregate
    // just written, so the scrape never recomputes on the hot path (they are
    // eventually-consistent to `usageRollupIntervalMs`). `reconcileGauge` evicts
    // series for buckets that no longer exist (cardinality tracks live buckets).
    // `sizeBytes` is a bigint converted to Number — Prometheus gauges are
    // float64, exact up to ~9 PB, well beyond a single-node store.
    const live = new Set(allBuckets.map((b) => b.name));
    await reconcileGauge(this.prom.storageBytes, live, (name) =>
      Number(agg.get(name)?.sizeBytes ?? 0n),
    );
    await reconcileGauge(this.prom.objectCount, live, (name) => agg.get(name)?.objectCount ?? 0);

    // Replication-outbox depth (STORY-1202): pending (fresh) / inflight (already
    // attempted, retrying) / failed. When replication is disabled the outbox is
    // empty — set all three to 0 and skip the query entirely.
    await this.refreshReplicationDepth();

    // Integrity gauges (STORY-1204): live per-status object counts + the last
    // scrub run timestamp, sourced from the SAME read model the admin status
    // endpoint uses. Counts only — never an object key or a credential.
    await this.refreshIntegrity();

    this.log.debug(
      `usage-rollup: sampled ${allBuckets.length} bucket(s) + ${SURFACES.length} surface(s) @ ${sampledAt.toISOString()}`,
    );
  }

  /**
   * Set the `replication_outbox_depth{status}` gauge for pending/inflight/failed.
   * When replication is disabled the outbox is always empty, so we zero the three
   * series and skip the aggregate query. Otherwise `ReplicationStatusService`
   * splits pending into fresh (`pending`) vs already-attempted (`inflight`).
   */
  private async refreshReplicationDepth(): Promise<void> {
    const gauge = this.prom.replicationOutboxDepth;
    if (!this.replicationConfig.enabled) {
      gauge.set({ status: 'pending' }, 0);
      gauge.set({ status: 'inflight' }, 0);
      gauge.set({ status: 'failed' }, 0);
      return;
    }
    const status = await this.replicationStatus.getStatus();
    gauge.set({ status: 'pending' }, status.pendingCount);
    gauge.set({ status: 'inflight' }, status.inflightCount);
    gauge.set({ status: 'failed' }, status.failedCount);
  }

  /**
   * Set `openbucket_integrity_objects{status}` (ok/corrupt/unchecked) and
   * `openbucket_integrity_last_run_timestamp` from the integrity read model. Only
   * counts + a timestamp are exposed — never an object key or a target credential
   * (EPIC-08: /metrics must not leak secrets).
   */
  private async refreshIntegrity(): Promise<void> {
    const status = await this.integrityStatus.getStatus();
    this.prom.integrityObjects.set({ status: 'ok' }, status.ok);
    this.prom.integrityObjects.set({ status: 'corrupt' }, status.corrupt);
    this.prom.integrityObjects.set({ status: 'unchecked' }, status.unchecked);
    this.prom.integrityLastRunTimestamp.set(
      status.lastRunAt ? Math.floor(Date.parse(status.lastRunAt) / 1000) : 0,
    );
  }
}
