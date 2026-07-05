import type { Surface } from './request-metrics.service';

/**
 * Bounded-cardinality label derivation for the Prometheus HTTP metrics
 * (STORY-1202, TASK-3621). Every value produced here comes from a small finite
 * set — NEVER the raw URL, bucket name, object key, IP, or any header — so the
 * `openbucket_http_*` families can never suffer a cardinality blow-up (CWE-770),
 * matching the "counts only, never URLs/keys/signatures" rule the in-memory
 * `RequestMetricsService` already follows (EPIC-08 / STORY-0705).
 */

/** The finite `status_class` label set. */
export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

/** The finite `route_class` label set. */
export type RouteClass = 'admin' | 's3-service' | 's3-bucket' | 's3-object' | 's3';

/**
 * Collapse an HTTP status code to its class (`2xx`, `4xx`, …). Bounds the status
 * dimension to five values. Anything outside 100-599 clamps to the nearest end
 * so a bogus code can't introduce a new series.
 */
export function statusClass(code: number): StatusClass {
  if (code < 200) return '1xx';
  if (code < 300) return '2xx';
  if (code < 400) return '3xx';
  if (code < 500) return '4xx';
  return '5xx';
}

/**
 * Derive the bounded `route_class` label from the request surface and the
 * classifier-assigned S3 scope. Admin (and everything non-S3) collapses to the
 * constant `'admin'`; the S3 data plane uses the finite `s3Scope`
 * (`s3-service`|`s3-bucket`|`s3-object`) the `RequestClassifierMiddleware`
 * already set — with a defensive `'s3'` fallback when the scope is somehow
 * unset. Pure (no ExecutionContext) so it is trivially unit-testable.
 */
export function routeClass(surface: Surface, s3Scope: string | undefined): RouteClass {
  if (surface !== 's3') return 'admin';
  switch (s3Scope) {
    case 's3-service':
    case 's3-bucket':
    case 's3-object':
      return s3Scope;
    default:
      return 's3';
  }
}
