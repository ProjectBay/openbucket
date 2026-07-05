import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * DI token carrying the fully-constructed {@link PromMetrics} family holder
 * (registry + every OpenBucket metric). Injected by the request-metrics
 * interceptor (TASK-3621), the usage-rollup runner (TASK-3622) and the
 * `/metrics` controller (TASK-3623) so they all write into / read from the SAME
 * instances.
 */
export const PROM_METRICS = Symbol('openbucket:prom-metrics');

/**
 * DI token for the shared `prom-client` {@link Registry}. Host apps that want to
 * scrape the registry directly (e.g. bolt it onto their own `/metrics` route)
 * can `@Inject(METRICS_REGISTRY)` it. Aliased to `PROM_METRICS.registry`.
 */
export const METRICS_REGISTRY = Symbol('openbucket:metrics-registry');

/**
 * The set of every OpenBucket Prometheus metric, constructed once by
 * {@link buildPromMetrics} and shared through DI.
 *
 * Label cardinality is deliberately bounded (CWE-770): the HTTP families carry
 * only `surface`/`method`/`route_class`/`status_class` — coarse, finite
 * dimensions — NEVER the raw URL, object key, bucket name, or client IP. The
 * `bucket` gauges are bounded by the number of live buckets (stale series are
 * evicted by the rollup reconciler, TASK-3622). No secret is ever a label or a
 * metric name (EPIC-08 / STORY-0705 posture).
 */
export interface PromMetrics {
  /** The single registry these families register into; scraped by `/metrics`. */
  readonly registry: Registry;
  /** Total HTTP requests, by surface/method/route_class/status_class. */
  readonly httpRequestsTotal: Counter<'surface' | 'method' | 'route_class' | 'status_class'>;
  /** Request latency (seconds), same bounded label set as the counter. */
  readonly httpRequestDurationSeconds: Histogram<
    'surface' | 'method' | 'route_class' | 'status_class'
  >;
  /** Total S3 operations, by the finite resolved operation name (PutObject, …). */
  readonly s3OperationsTotal: Counter<'operation'>;
  /** Per-bucket stored bytes (refreshed on the rollup tick). */
  readonly storageBytes: Gauge<'bucket'>;
  /** Per-bucket live object count (refreshed on the rollup tick). */
  readonly objectCount: Gauge<'bucket'>;
  /** Replication outbox depth by status (pending/inflight/failed). */
  readonly replicationOutboxDepth: Gauge<'status'>;
  /** Live object count by integrity status (ok/corrupt/unchecked) — STORY-1204. */
  readonly integrityObjects: Gauge<'status'>;
  /** Unix seconds of the last integrity scrub tick that did work (0 if never). */
  readonly integrityLastRunTimestamp: Gauge<string>;
}

/**
 * Histogram buckets (seconds) sized for the S3 latency spread: small admin JSON
 * calls (single-digit ms) up to large multipart PUTs (multi-second). Constant,
 * not configurable — a runtime-tunable bucket set would let a misconfig explode
 * per-series memory.
 */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Construct the shared registry + every OpenBucket metric family ONCE.
 *
 * A brand-new {@link Registry} is used (never the process-global
 * `client.register`) and `collectDefaultMetrics` is pointed at it with an
 * `openbucket_` prefix, so:
 *  - default process metrics are namespaced (e.g. `openbucket_process_cpu_…`),
 *  - two OpenBucket module graphs in one Node process (a multi-tenant host)
 *    each get their own registry and never collide with a "metric already
 *    registered" error.
 *
 * Called by the `@Global` `MetricsModule`'s single value-factory, so it runs
 * exactly once per module instance.
 */
export function buildPromMetrics(): PromMetrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'openbucket_' });

  const labelNames = ['surface', 'method', 'route_class', 'status_class'] as const;

  const httpRequestsTotal = new Counter({
    name: 'openbucket_http_requests_total',
    help: 'Total HTTP requests handled, by surface, method, route class and status class.',
    labelNames,
    registers: [registry],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'openbucket_http_request_duration_seconds',
    help: 'HTTP request latency in seconds, by surface, method, route class and status class.',
    labelNames,
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  const s3OperationsTotal = new Counter({
    name: 'openbucket_s3_operations_total',
    help: 'Total S3 operations handled, by resolved operation name.',
    labelNames: ['operation'] as const,
    registers: [registry],
  });

  const storageBytes = new Gauge({
    name: 'openbucket_storage_bytes',
    help: 'Stored object bytes per bucket (refreshed on the usage-rollup tick).',
    labelNames: ['bucket'] as const,
    registers: [registry],
  });

  const objectCount = new Gauge({
    name: 'openbucket_object_count',
    help: 'Live object count per bucket (refreshed on the usage-rollup tick).',
    labelNames: ['bucket'] as const,
    registers: [registry],
  });

  const replicationOutboxDepth = new Gauge({
    name: 'openbucket_replication_outbox_depth',
    help: 'Replication outbox depth by status (pending, inflight, failed).',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  const integrityObjects = new Gauge({
    name: 'openbucket_integrity_objects',
    help: 'Live object count by integrity status (ok, corrupt, unchecked).',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  const integrityLastRunTimestamp = new Gauge({
    name: 'openbucket_integrity_last_run_timestamp',
    help: 'Unix seconds of the last integrity scrub tick that did work (0 if never).',
    registers: [registry],
  });

  return {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    s3OperationsTotal,
    storageBytes,
    objectCount,
    replicationOutboxDepth,
    integrityObjects,
    integrityLastRunTimestamp,
  };
}
