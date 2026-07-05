---
id: TEST-1202
title: Prometheus /metrics endpoint, guard, metric families, and OTel no-op
covers: [STORY-1202, TASK-3620, TASK-3621, TASK-3622, TASK-3623, TASK-3624]
status: backlog
level: e2e
---

## Goal

Verify that OpenBucket exposes a correct, guarded Prometheus scrape at
`<mountPath>/metrics`; that the HTTP/S3/storage/replication metric families are
populated by REUSING the EPIC-12 interceptor + rollup tick (single instrumentation,
bounded cardinality); that the guard modes (`off|public|token`) and secret handling
respect the EPIC-08 posture; and that the OpenTelemetry hooks are a true no-op unless
an SDK is present and never leak URLs/keys/secrets.

## Setup

- Jest + supertest against a booted `OpenBucketCoreModule` (and the headless variant),
  the standard in-repo pattern. `OPENBUCKET_TEST_MODE=1`, `TestClock` so rollup ticks
  can be fast-forwarded.
- A temp `DATA_DIR` with libsql migrated. Seed 2 buckets with a few objects (so the
  storage/object gauges are non-zero after a tick).
- Boot matrices: `metrics.mode` ∈ {`off`,`public`,`token`} (token = a strong
  `strongSecret`-valid value); `tracing.enabled` ∈ {false,true}; replication
  {disabled, enabled-with-outbox-rows}.
- For OTel: a stub tracer/provider registered via `@opentelemetry/api`
  `setGlobalTracerProvider` in the enabled case; a separate case with the api module
  unresolved (mock `require` to throw).

## Cases

1. Registry construction (TASK-3620, unit): building `PromMetrics` twice in one process
   does not throw a "metric already registered" error; each holds its own `Registry`;
   scraping yields `openbucket_process_cpu_seconds_total` (default metrics, prefixed).
2. HTTP counter/histogram reuse (TASK-3621): given a mix of admin JSON calls and S3
   PUT/GET/LIST; when scraped; then `openbucket_http_requests_total` sums to the request
   count with ONLY labels `surface,method,route_class,status_class` present (assert no
   label value equals a bucket name, object key, or URL), and
   `openbucket_http_request_duration_seconds_count` equals the same total with `_sum>0`.
3. Single instrumentation (TASK-3621): assert exactly one `RequestMetricsInterceptor` is
   bound (no double count) — issue N requests, expect the counter to advance by exactly N.
4. Label cardinality bound (TASK-3621, unit): `routeClass`/`statusClass` over a fuzzed
   set of contexts/status codes yields a finite label set (`status_class` ∈ {1xx..5xx};
   `route_class` ∈ {admin, s3-service, s3-bucket, s3-object}).
5. S3-operation counter (TASK-3622): a `PutObject` then `ListObjectsV2`; then
   `openbucket_s3_operations_total{operation="PutObject"}` and `{operation="ListObjectsV2"}`
   are 1 each; a request whose shape yields no `operation` creates NO `s3_operations_total`
   series (no `unknown` label).
6. Storage/object gauges from the tick (TASK-3622): run one `UsageRollupRunner` tick; then
   `openbucket_storage_bytes{bucket}` / `openbucket_object_count{bucket}` equal the
   `UsageSample` rows written in that tick for both seeded buckets.
7. Gauge eviction (TASK-3622, unit): delete a bucket, run a tick; the removed bucket's
   `storage_bytes`/`object_count` series is gone (reconcileGauge eviction).
8. Replication depth (TASK-3622): with replication enabled and N pending + M failed outbox
   rows, `openbucket_replication_outbox_depth{status="pending"|"inflight"|"failed"}` matches
   `countByStatus`/`ReplicationStatusService`; with replication disabled all three are `0`
   and the endpoint still returns 200.
9. Public mode (TASK-3623): `metrics.mode='public'`; `GET /metrics` → `200`,
   `Content-Type: text/plain; version=0.0.4`, body contains `openbucket_` families.
10. Token mode (TASK-3623): `metrics.mode='token'`; no header → `401`; wrong token → `401`;
    a wrong token of DIFFERENT length → still `401` (no throw, timingSafeEqual length-safe);
    correct `Bearer <token>` → `200`.
11. Off mode (TASK-3623): `metrics.mode='off'` (default); `GET /metrics` does NOT return a
    Prometheus body (falls through to the S3 route → S3-style error/404), leaking no registry.
12. No SigV4 on /metrics (TASK-3623): an UNSIGNED scrape in public mode succeeds — proving
    the classifier tags `/metrics` as `admin`-kind and `SigV4Guard` skips it; a scrape under
    a non-empty `mountPath` (e.g. `/storage/metrics`) also resolves (not shadowed by
    `:bucket`).
13. Boot validation (TASK-3623): `metrics.mode='token'` with an empty/weak token fails
    `validateSecurityCriticalOptions`/env schema at boot with a clear message; a valid
    token boots.
14. Secret redaction (TASK-3623): drive a token-mode scrape with logging on; assert the
    token value never appears in captured log output (Authorization redaction intact).
15. Throttling (TASK-3623): rapid scrapes are bounded by the admin `default` (100/min)
    throttler (a `429` after the limit), confirming the endpoint is not on the wide S3 bucket.
16. OTel disabled no-op (TASK-3624, unit): `tracing.enabled=false`; a spy proves
    `@opentelemetry/api` is never `require`d and `startActiveSpan` invokes `fn()` directly.
17. OTel api-absent (TASK-3624): `tracing.enabled=true` but `require('@opentelemetry/api')`
    throws; boot logs exactly one warning, does not throw, and requests still succeed
    (tracing no-op).
18. OTel enabled with SDK (TASK-3624): a stub tracer registered; a request produces one span
    named by `surface`/`route_class` with attributes limited to `http.method,route_class,
    surface` — assert NO URL/key/bucket/secret attribute is present, and the span ends on
    both success and error paths.
19. Build without OTel (TASK-3624): `nx build openbucket-backend` succeeds with
    `@opentelemetry/api` NOT installed, and `prom-client` appears externalized in the emitted
    dist `package.json`.

## Tooling

- Framework: jest + supertest (endpoint, guard, cardinality); `@aws-sdk/client-s3` for the
  S3 op-counter traffic in cases 2/5; `prom-client` parsing of the scrape text for
  assertions.
- Runner: `nx test nestjs` (unit: registry, route-class, guard, rollup, tracing) and
  `nx e2e openbucket-backend-e2e` (endpoint/guard/families end-to-end).

## Pass criteria

- [ ] Cases 1–19 pass on `nx test nestjs` / `nx e2e openbucket-backend-e2e`.
- [ ] The scrape body contains only bounded label values — no test finds a bucket name as a
      `route_class`/`status_class` label or any URL/key/signature/secret in any metric label,
      metric name, span attribute, or log line.
- [ ] `metrics.mode` matrix, boot validation, and throttling all behave as specified; OTel is
      a verified no-op when disabled or when the api/SDK is absent.
- [ ] `nx build openbucket-backend` builds with `@opentelemetry/api` absent and `prom-client`
      externalized.

## References

- Reused: `libs/nestjs/src/lib/common/interceptors/request-metrics.interceptor.ts`,
  `libs/nestjs/src/lib/common/metrics/request-metrics.service.ts`,
  `libs/nestjs/src/lib/common/background/usage-rollup.runner.ts`,
  `libs/nestjs/src/lib/persistence/repositories/replication-outbox.repository.ts`
  (`countByStatus`), `libs/nestjs/src/lib/domain/replication/replication-status.service.ts`.
- Wiring: `libs/nestjs/src/lib/open-bucket-core.module.ts` (register before `S3Module`),
  `libs/nestjs/src/lib/common/middleware/request-classifier.middleware.ts` (`/metrics` branch),
  `libs/nestjs/src/lib/admin/health/health.controller.ts` (`@Public` probe pattern),
  `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts`.
- Config/deps: `libs/nestjs/src/lib/open-bucket-options.ts`, `common/config/env.schema.ts`,
  `common/config/config-source.ts`, `common/config/app-config.service.ts`,
  `apps/openbucket-backend/webpack.config.js`, `libs/nestjs/package.json`, root `package.json`.
</content>
