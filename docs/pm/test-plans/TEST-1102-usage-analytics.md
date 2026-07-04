---
id: TEST-1102
title: Usage analytics rollup, endpoints, and dashboard
covers: [STORY-1102, TASK-3320, TASK-3321, TASK-3322, TASK-3323, TASK-3324]
status: backlog
level: integration
---

## Goal

Verify the end-to-end usage-analytics pipeline: the grouped storage aggregate and
sample persistence, the request-metrics counters, the config-driven rollup tick
(sampling + retention pruning under a fake `Clock`), the three admin endpoints
(auth, shapes, downsampling, empty state), and that the dashboard renders charts
from the endpoints. Backend cases use an in-memory libsql ORM (the
`multipart-cleanup.runner.spec.ts` harness); endpoint cases use supertest against
the Nest app; the frontend case uses the Angular TestBed.

## Setup

- **ORM**: `MikroORM.init({ dbName: ':memory:' })` with `ENTITIES` extended by
  `UsageSample` + `RequestMetricSample`, running the initial migration plus
  `Migration20260705000001_usage_samples` (mirrors
  `multipart-cleanup.runner.spec.ts`). `foreign_keys = ON`.
- **Clock**: `{ nowMs: () => now }` stub so ticks and retention can fast-forward.
- **Seed**: buckets `b1` (two objects, sizes 100+200), `b2` (one object, size 50),
  `b3` (empty). `RequestMetricsService` primed via `record()` calls.
- **HTTP**: Nest app booted with a valid admin JWT (reuse the admin auth test
  helper) for endpoint cases; one unauthenticated agent for the 401 case.
- **Frontend**: standalone `HomeComponent` under TestBed with the generated
  `AnalyticsService` replaced by a stub returning fixture series.

## Cases

1. **Grouped aggregate (TASK-3320)** — given the seed, `ObjectRepository
   .aggregateByBucket()` returns rows for `b1` (`objectCount=2, sizeBytes=300`)
   and `b2` (`1, 50`); `b3` is absent. Each row equals `ObjectService.statsFor`
   for that bucket. Then run the migration `down()` and assert both tables are
   dropped (`sqlite_master` has no `usage_samples`/`request_metric_samples`).
2. **Sample entities persist (TASK-3320)** — create a `UsageSample`
   (`bigint` size, `integer` count) and a `RequestMetricSample`, flush, re-read
   via a fresh fork: values round-trip and `Number(sizeBytes)` is exact.
   `bucketName` is a plain column — deleting bucket `b1` leaves its samples intact
   (no cascade).
3. **Request-metrics interceptor (TASK-3321)** — driving the interceptor with a
   mock `CallHandler`: a 200 S3 request increments `s3.requestCount` only; a 503
   increments `s3.errorCount` too; an admin 200 increments `admin.requestCount`.
   `drain()` returns the totals and zeroes the accumulators; a second `drain()`
   with no traffic returns all zeros.
4. **Rollup writes a batch (TASK-3322)** — with the fixed `Clock`, one
   `UsageRollupRunner.run()` inserts exactly one `usage_samples` row per bucket
   including `b3` as `0/0`, all sharing one `sampledAt`, plus one
   `request_metric_samples` row per surface (`admin`, `s3`) whose counts equal the
   drained accumulators. `metrics.drain()` is called exactly once.
5. **Retention prune (TASK-3322)** — after case 4, advance the `Clock` past
   `usageRetentionDays`, run again: the first batch is `nativeDelete`d while the
   new batch survives. Assert row counts before/after and that a misconfigured
   sub-60s interval is rejected by the env schema (`USAGE_ROLLUP_INTERVAL_MS`).
6. **Downsampling + aggregation (TASK-3323)** — seed 1,200 `usage_samples` across
   a 30-day span; `AnalyticsService.getStorage({range:'30d'})` returns
   `points.length <= 500`, sorted ascending by `t`, with instance totals =
   `sum(sizeBytes)` per `sampledAt`; `?bucket=b1` restricts via exact match (a
   `bucket=b1%` value does NOT act as a LIKE wildcard).
7. **Breakdown endpoint (TASK-3323)** — `GET /api/admin/analytics/buckets`
   returns latest-per-bucket rows summing to `totalSizeBytes`; a deleted bucket's
   stale samples are excluded; `sharePct` sums to ~100 (±rounding).
8. **Request series + surfacing (TASK-3321, TASK-3323)** — drive a few S3 and
   admin requests, run the rollup, then `GET /api/admin/analytics/requests
   ?range=24h` returns per-surface `{requestCount, errorCount}` matching what was
   driven.
9. **Auth + validation (TASK-3323)** — all three endpoints return `401` for the
   unauthenticated agent (JwtAuthGuard, incl. a mixed-case `/api/Admin/...` path
   per EPIC-08 STORY-0700); `?range=bogus` returns `400` from the zod pipe; a
   fresh instance with no samples returns `200` with empty arrays.
10. **Signal store mapping (TASK-3324)** — `AnalyticsSignalStore.refresh()` fans
    out the three stubbed calls, populates `storage/breakdown/requests` signals,
    sets `loading` false, and the SVG scaling helper maps an empty series to a
    valid (degenerate) path without throwing.
11. **Dashboard render (TASK-3324)** — `HomeComponent` under TestBed with the
    stubbed store renders the area chart, the bar breakdown, and the request
    chart; sizes display via `ByteSizePipe`; with an empty fixture it shows the
    "collecting data" state and no console error.

## Tooling

- Framework: jest + supertest (backend), @angular/core TestBed + jest (frontend)
- Runner: `nx test nestjs` (backend units + endpoints), `nx test openbucket-frontend`

## Pass criteria

- [ ] Cases 1–5 pass under `nx test nestjs` (aggregate, persistence, interceptor,
      rollup, retention) with the fake `Clock`.
- [ ] Cases 6–9 pass: endpoints enforce auth + range allow-list, downsample to
      `<= 500` points, exclude deleted buckets, and return empty arrays (not 404)
      on a fresh instance.
- [ ] Cases 10–11 pass under `nx test openbucket-frontend`.
- [ ] `nx build openbucket-frontend` and the api-client `git diff --exit-code`
      staleness gate both succeed.

## References

- `libs/nestjs/src/lib/common/background/multipart-cleanup.runner.spec.ts`,
  `lifecycle-sweep.runner.spec.ts` (in-memory ORM + fake-Clock harness)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` (`statsFor` baseline)
- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.spec.ts`
  (admin endpoint test style), `admin/dto-schemas.spec.ts`
- EPIC-08 [STORY-0700] (auth 401 regression), [STORY-0704]/[STORY-0706]
  (range allow-list + exact-match, no LIKE)
