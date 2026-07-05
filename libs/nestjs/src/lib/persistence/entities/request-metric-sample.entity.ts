import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

/** The request surface a metric sample belongs to. */
export type RequestSurface = 'admin' | 's3';

/**
 * A point-in-time request-metrics sample for one surface (`admin` vs `s3`),
 * written by the usage-rollup runner (STORY-1102, TASK-3320). Drained from the
 * in-memory counters ({@link RequestMetricsService}) once per rollup tick.
 *
 * `errorCount` counts responses `>= 400` (4xx + 5xx). `windowMs` records the
 * tick interval this sample covers, so a rate = `count / (windowMs/1000)` stays
 * reconstructable even if the rollup interval is later reconfigured.
 */
@Entity({ tableName: 'request_metric_samples' })
@Index({ name: 'ix_request_metric_samples_sampled_at', properties: ['sampledAt'] })
export class RequestMetricSample {
  @PrimaryKey({ type: 'string' })
  id!: string; // uuid v7 — generated in the runner

  @Property({ type: 'datetime' })
  sampledAt!: Date;

  @Property({ type: 'string', length: 8 })
  surface!: RequestSurface;

  @Property({ type: 'integer' })
  windowMs!: number;

  @Property({ type: 'integer' })
  requestCount = 0;

  @Property({ type: 'integer' })
  errorCount = 0;
}
