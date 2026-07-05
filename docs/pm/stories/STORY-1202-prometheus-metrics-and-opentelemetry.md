---
id: STORY-1202
title: Prometheus /metrics + OpenTelemetry
epic: EPIC-13
status: backlog
size: L
risk: medium
---

## User story

As an operator running OpenBucket (standalone or embedded via `@openbucket/nestjs`),
I want a Prometheus-format `/metrics` scrape endpoint plus optional OpenTelemetry
tracing hooks, so that I can wire OpenBucket into my existing observability stack
(Prometheus/Grafana, an OTLP collector) without scraping logs or polling the admin
JSON API, and without paying any cost when I don't use them.

## Description

This Story exposes a Prometheus text-format endpoint at `<mountPath>/metrics`
(via `prom-client`) that surfaces: an HTTP request counter + latency histogram
(labelled by `surface`/`method`/`route_class`/`status_class`), an S3-operation
counter (labelled by the already-resolved `req.openbucket.operation`), storage-usage
+ object-count gauges, a replication-outbox depth gauge, and standard Node process
metrics. All in-process counters/histograms are fed by **extending** the existing
EPIC-12 `RequestMetricsInterceptor` and `UsageRollupRunner` tick — never a second
instrumentation pass — so cardinality stays bounded (a fixed label set, no raw
paths/keys/IPs). The endpoint is guarded by a configurable mode (`off` | `public` |
`token`); in `token` mode a dedicated bearer guard compares against a strong
`metricsToken` with `timingSafeEqual`. Finally the Story adds a thin OpenTelemetry
tracing seam that is a **no-op unless** an OTel SDK is registered (optional
dependency, dynamic import, global no-op tracer fallback) so there is zero runtime
weight for hosts that don't opt in. No S3 wire behaviour changes and the EPIC-08
security posture (authz, throttling, secret redaction) is preserved.

## Acceptance criteria

- [ ] `GET <mountPath>/metrics` returns Prometheus text-format (`Content-Type: text/plain; version=0.0.4`) when `metrics.mode` is `public` or `token`, and is not mapped at all (404 via the S3 wildcard) when `metrics.mode` is `off` (default).
- [ ] A single shared `prom-client` `Registry` is provided app-wide; `collectDefaultMetrics` is registered exactly once with an `openbucket_` prefix, so process/GC/heap gauges appear without double-registration errors on module re-init.
- [ ] The HTTP request counter `openbucket_http_requests_total` and latency histogram `openbucket_http_request_duration_seconds` are incremented **only** from the existing `RequestMetricsInterceptor` (no new interceptor is bound), with labels `surface` (`admin|s3`), `method`, `route_class`, `status_class` (`2xx|3xx|4xx|5xx`) — all bounded, never a raw URL/key/IP.
- [ ] `openbucket_s3_operations_total{operation=...}` counts S3 operations using the already-set `req.openbucket.operation` (from `resolveS3Operation`), and records nothing (no `unknown` explosion) when `operation` is unset.
- [ ] `openbucket_storage_bytes{bucket=...}` and `openbucket_object_count{bucket=...}` gauges are set from the `UsageRollupRunner` tick (reusing its per-bucket aggregate), not recomputed on scrape; gauges for deleted buckets are removed so cardinality tracks live buckets.
- [ ] `openbucket_replication_outbox_depth{status=pending|inflight|failed}` gauge reflects `ReplicationOutboxRepository.countByStatus()` / `ReplicationStatusService`, and reads `0` (endpoint still 200) when replication is disabled.
- [ ] In `token` mode, a request without `Authorization: Bearer <metricsToken>` gets `401`, a wrong token gets `401` (compared with `crypto.timingSafeEqual`, length-safe), and a correct token gets `200`; the token is validated by `strongSecret()` at boot and never appears in logs (covered by the existing `authorization` pino redaction).
- [ ] `/metrics` is classified so the `SigV4Guard` does **not** attempt SigV4 verification on it (it is not treated as an S3 `:bucket` request), and the `MetricsController` route is registered before `S3Module` so the greedy `:bucket` route cannot shadow it.
- [ ] An OpenTelemetry span wraps request handling **only** when `@opentelemetry/api` resolves to a real (SDK-registered) tracer; with no SDK present the tracing hook is a no-op and adds no measurable latency, and the library does not hard-depend on any `@opentelemetry/*` package (bundle builds without it installed).
- [ ] `prom-client` is added following the native-dep externalization rule (declared in `libs/nestjs/package.json` dependencies → auto-externalized by `apps/openbucket-backend/webpack.config.js`, and in the root `package.json`); `@opentelemetry/api` is an **optional** peer/optional dependency only.
- [ ] Library config knobs (`metrics.mode`, `metrics.token`, `tracing.enabled`) are wired through all four config seams (`open-bucket-options.ts`, `env.schema.ts`, `config-source.ts`, `app-config.service.ts`) with the standalone env path (`METRICS_MODE`, `METRICS_TOKEN`, `OTEL_TRACING_ENABLED`) matching.

## Tasks

- [TASK-3620] Add prom-client dependency and the shared metrics registry module
- [TASK-3621] Emit HTTP request counter and latency histogram by extending the request-metrics interceptor
- [TASK-3622] Feed S3-operation, storage/object-count, and replication-depth metrics from the rollup tick
- [TASK-3623] Add the guarded /metrics controller, bearer guard, config knobs, and classifier/routing wiring
- [TASK-3624] Add optional no-op OpenTelemetry tracing hooks

## Test plan

- [TEST-1202] Prometheus /metrics endpoint, guard, metric families, and OTel no-op

## Dependencies

- Blocks: —
- Blocked by: none functionally. Extends (must not regress) EPIC-12 usage
  analytics — [STORY-1102] (`RequestMetricsInterceptor`, `RequestMetricsService`,
  `UsageRollupRunner`, `UsageSample`) — and preserves the EPIC-08 posture:
  [STORY-0700] (`JwtAuthGuard` fail-closed), [STORY-0704] (throttler buckets),
  [STORY-0705] (log/secret redaction). Consumes [STORY-0900]/[STORY-0902]
  replication read model (`ReplicationOutboxRepository.countByStatus`,
  `ReplicationStatusService`).

## References

- Interceptor to reuse: `libs/nestjs/src/lib/common/interceptors/request-metrics.interceptor.ts` (`RequestMetricsInterceptor`), `libs/nestjs/src/lib/common/metrics/request-metrics.service.ts` (`RequestMetricsService`, `Surface`), `libs/nestjs/src/lib/common/common.module.ts` (global `APP_INTERCEPTOR` wiring).
- Rollup to reuse: `libs/nestjs/src/lib/common/background/usage-rollup.runner.ts` (`UsageRollupRunner`, `ObjectRepository.aggregateByBucket`, per-tick `RequestContext`), `libs/nestjs/src/lib/common/background/background.service.ts` (`ScheduledTask`, `SCHEDULED_TASKS`), `background.module.ts` (providers + factory `inject` list).
- Replication depth: `libs/nestjs/src/lib/persistence/repositories/replication-outbox.repository.ts` (`countByStatus`), `libs/nestjs/src/lib/domain/replication/replication-status.service.ts` (`ReplicationStatusService.getStatus`), `libs/nestjs/src/lib/storage/replication/replication-config.ts` (`REPLICATION_CONFIG`, `enabled`).
- S3 operation label: `libs/nestjs/src/lib/s3/routing/operation-resolver.ts` (`resolveS3Operation`), `libs/nestjs/src/lib/s3/routing/operation.decorator.ts`, `libs/nestjs/src/lib/s3/s3-throttle.ts` (`isS3ThrottledRoute`, surface).
- Guard/route wiring: `libs/nestjs/src/lib/admin/health/health.controller.ts` + `health.module.ts` (public probe pattern), `libs/nestjs/src/lib/common/auth/public.decorator.ts` (`@Public`), `libs/nestjs/src/lib/open-bucket-core.module.ts` (`buildCoreImports` — register before `S3Module`), `libs/nestjs/src/lib/common/middleware/request-classifier.middleware.ts` (`/metrics` classification), `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts`.
- Config seams: `libs/nestjs/src/lib/open-bucket-options.ts` (`OpenBucketModuleOptions`, `ResolvedOpenBucketOptions`, `resolveOptions`, `validateSecurityCriticalOptions`, `strongSecret`), `libs/nestjs/src/lib/common/config/env.schema.ts`, `libs/nestjs/src/lib/common/config/config-source.ts`, `libs/nestjs/src/lib/common/config/app-config.service.ts`.
- Dependency externalization: `apps/openbucket-backend/webpack.config.js` (externalizes `libs/nestjs/package.json` dependency keys), `libs/nestjs/package.json`, root `package.json`.
- New dependency: `prom-client` (runtime), `@opentelemetry/api` (OPTIONAL peer/optional — never a hard dependency).
- Interfaces produced: `MetricsModule`, `METRICS_REGISTRY`, `PromMetrics` (metric-family holder), `MetricsController`, `MetricsAuthGuard`, `TracingModule`/`TracingService` (no-op-capable).
</content>
</invoke>
