---
id: STORY-1102
title: Usage analytics dashboard
epic: EPIC-12
status: backlog
size: M
risk: low
---

## User story

As an operator running OpenBucket, I want a dashboard that shows storage growth
over time, a per-bucket size breakdown, object counts, and request/error rates,
so that I can spot capacity trends and traffic anomalies at a glance instead of
inferring them from the bucket list or scraping logs.

## Description

This Story adds a lightweight, in-process usage-analytics pipeline. A new
background runner (reusing the `SCHEDULED_TASKS` tick from
`common/background/background.service.ts`) periodically samples per-bucket
object counts + live size via a single grouped SQL aggregate and writes
timestamped rows to a new `usage_samples` table; a global interceptor keeps
in-memory request/error counters per surface (s3 vs admin) that the same tick
flushes into `request_metric_samples`. A new `api/admin/analytics` controller
exposes server-downsampled time series and a per-bucket breakdown as
nestjs-zod DTOs, and the Angular home dashboard extends its existing stat-cards
with signal-driven SVG charts. Everything stays behind the existing admin
`JwtAuthGuard` and the `default` throttler bucket — no new auth surface, no S3
data-plane changes.

## Acceptance criteria

- [ ] A `UsageRollupRunner` implementing `ScheduledTask` is registered in
      `background.module.ts` (providers **and** the `SCHEDULED_TASKS` factory
      `inject` list) and fires on `AppConfigService.usageRollupIntervalMs`
      (default 15 min), inside a per-tick MikroORM `RequestContext`.
- [ ] Each tick writes one `usage_samples` row per existing bucket with a shared
      `sampledAt`, using a single `GROUP BY bucket_name` aggregate (no N+1), and
      one `request_metric_samples` row per surface for the elapsed window.
- [ ] Samples older than `AppConfigService.usageRetentionDays` (default 90) are
      pruned in the same tick, bounding table growth.
- [ ] `GET /api/admin/analytics/storage?range=7d[&bucket=<name>]` returns a
      time series of `{ t, sizeBytes, objectCount }`, capped at `<= 500` points
      via server-side downsampling; instance totals are summed across buckets.
- [ ] `GET /api/admin/analytics/buckets` returns the latest per-bucket
      `{ name, sizeBytes, objectCount, sharePct }` for buckets that still exist,
      summing to the instance total.
- [ ] `GET /api/admin/analytics/requests?range=24h` returns a per-surface time
      series of `{ t, requestCount, errorCount }`.
- [ ] All three endpoints return `401` without a valid admin bearer token and
      are subject to the admin `default` throttler; `range` is validated against
      an allow-list (`1h|24h|7d|30d|90d`) so no unbounded scan is possible.
- [ ] The home dashboard renders a storage-over-time area chart, a per-bucket
      bar breakdown, and a request/error mini-chart, reusing `StatCardComponent`
      and `ByteSizePipe`, driven by a signal store that refreshes on a bounded
      interval (>= 30 s, well under the 100/min throttle).
- [ ] The bucket size totals shown match `ObjectService.statsFor` for the same
      buckets (the rollup and the live stats agree within one sampling interval).

## Tasks

- [TASK-3320] Add usage-sample persistence (entities, migration, grouped repo aggregate)
- [TASK-3321] Add request-metrics interceptor and in-memory counter service
- [TASK-3322] Implement the usage-rollup background runner with retention pruning
- [TASK-3323] Add the admin analytics module, controller, and nestjs-zod DTOs
- [TASK-3324] Build the frontend analytics signal store and dashboard charts

## Test plan

- [TEST-1102] Usage analytics rollup, endpoints, and dashboard

## Dependencies

- Blocks: —
- Blocked by: none functionally. Reuses (must not regress) the EPIC-08 admin
  auth posture — [STORY-0700] (`JwtAuthGuard` fail-closed, case-insensitive),
  the [STORY-0704] throttler `default` bucket, and [STORY-0705] log redaction
  (the request-metrics interceptor counts only, it never logs URLs/keys/sigs).
- Consumes the existing bucket/object aggregate `ObjectService.statsFor` and the
  `SCHEDULED_TASKS` background tick.

## References

- Frontend: `apps/openbucket-frontend/src/app/home/home.component.ts`
  (`HomeComponent`, stat-cards, `totalObjects`/`totalSize` computed),
  `apps/openbucket-frontend/src/app/shared/ui/stat-card.component.ts`
  (`StatCardComponent`), `shared/ui/byte-size.pipe.ts`,
  `apps/openbucket-frontend/src/app/buckets/buckets.signal-store.ts`
  (signal-store pattern), `app.routes.ts`, `i18n/en.translations.ts`.
- Background: `libs/nestjs/src/lib/common/background/background.service.ts`
  (`ScheduledTask`, `SCHEDULED_TASKS`, per-tick `RequestContext`),
  `background.module.ts` (registration factory),
  `lifecycle-sweep.runner.ts` (batching / `Clock` / `setImmediate` pattern).
- Domain/persistence: `libs/nestjs/src/lib/domain/objects/object.service.ts`
  (`statsFor` raw aggregate), `persistence/repositories/object.repository.ts`,
  `persistence/entities/{lifecycle-state,bucket,object}.entity.ts`,
  `persistence.module.ts` (`ENTITIES`, `forFeature`, repo providers),
  `mikro-orm.config.ts`, `migrations/Migration20260701000001_object_content_sha256.ts`.
- Admin: `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.ts` +
  `dto/*.dto.ts` (nestjs-zod `createZodDto`, `@Controller('api/admin/...')`),
  `admin/buckets/buckets-admin.module.ts`, `admin/admin.module.ts`
  (`ADMIN_CONTROLLER_MODULES`, `JwtAuthGuard` via `APP_GUARD`, `ThrottlerModule`),
  `open-bucket.module.ts` (`RouterModule` children), `admin/audit/audit.service.ts`.
- Security posture (do not regress): `libs/nestjs/src/lib/s3/authz/` (policy
  evaluator — admin-plane analytics does not touch it), `s3/s3-throttle.ts`
  (surface classification), EPIC-08 [STORY-0700]/[STORY-0704]/[STORY-0705].
- Config: `libs/nestjs/src/lib/common/config/app-config.service.ts` and the zod
  env schema (new `usageRollupIntervalMs` / `usageRetentionDays` knobs).
- Delivery: `libs/api-client/project.json` (`openapi-generator` regenerates the
  Angular client once the new DTOs are exported).
- Interfaces produced: `UsageSample`, `RequestMetricSample`,
  `UsageRollupRunner`, `RequestMetricsService`, `AnalyticsService`,
  `AnalyticsController`, `StorageSeriesDto`, `BucketBreakdownDto`,
  `RequestSeriesDto`, `AnalyticsSignalStore`.
- No new backend runtime dependency; the frontend charts are hand-rolled inline
  SVG (no chart-lib dependency added).
