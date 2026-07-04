---
id: TASK-3321
title: Add request-metrics interceptor and in-memory counter service
story: STORY-1102
status: backlog
type: implementation
size: S
---

## Description

Add a global interceptor + a singleton counter service that tally request and
error counts per surface (`admin` vs `s3`) in memory. The counters are cheap
(two integers per surface plus a short per-minute ring for the live rate); the
rollup runner ([TASK-3322]) drains the accumulators each tick into
`request_metric_samples`. Nothing about request URLs, keys, or signatures is
retained — only counts — so this does not widen the log/secret surface hardened
in EPIC-08 [STORY-0705].

## Files to create / modify

- `libs/nestjs/src/lib/common/metrics/request-metrics.service.ts` — new
- `libs/nestjs/src/lib/common/interceptors/request-metrics.interceptor.ts` — new
- `libs/nestjs/src/lib/common/common.module.ts` — modify (provide the service +
  bind the interceptor via `APP_INTERCEPTOR`, and export the service)

## Implementation notes

- **`RequestMetricsService`** (`@Injectable()`, app singleton) holds per-surface
  accumulators plus a 60-slot per-minute ring for a live rate:
  ```ts
  type Surface = 'admin' | 's3';
  interface Accum { requestCount: number; errorCount: number }
  record(surface: Surface, statusCode: number): void; // errorCount += statusCode >= 400
  /** Atomically read-and-reset the accumulators; the runner calls this per tick. */
  drain(): Record<Surface, Accum>;
  /** Live requests-per-minute for the last full minute (dashboard stat card). */
  ratePerMinute(surface: Surface): number;
  ```
  `drain()` snapshots and zeroes in one synchronous call (single-threaded Node —
  no lock needed) so a concurrent `record()` between snapshot and reset is at
  worst attributed to the next window.
- **`RequestMetricsInterceptor`** — model it on
  `common/interceptors/shutdown-tracker.interceptor.ts` (a global interceptor
  that wraps the response). In `intercept`, classify the surface from the request
  and, in `tap({ next, error })` / `finalize`, call
  `metrics.record(surface, res.statusCode)`. Reuse the S3 surface signal rather
  than re-parsing paths: `isS3ThrottledRoute(context)` from `s3/s3-throttle.ts`
  → `'s3'`, else `'admin'`. For thrown `HttpException`s read
  `err.getStatus()`; for non-HTTP errors count as `500`.
- **Registration** — add to `common.module.ts` alongside the existing global
  providers: `{ provide: APP_INTERCEPTOR, useClass: RequestMetricsInterceptor }`
  and provide + `exports: [RequestMetricsService]` so `BackgroundModule` can
  inject it. Interceptor ordering is irrelevant (it only observes status).
- **Edge cases / DoS** — the ring and accumulators are O(1) memory regardless of
  traffic (no per-path or per-IP maps → no unbounded-cardinality memory blowup,
  unlike a naive label map). Counters are process-local and reset on restart;
  persisted history lives in `request_metric_samples`. Health/readiness probes
  (`admin/health`) are counted as `admin` — acceptable noise; document it.
- **Embeddable mode** — because the interceptor is bound in `common.module.ts`
  (imported by both the standalone app and `@openbucket/nestjs`), a host app that
  never renders the dashboard still pays only two integer increments per request.

## Acceptance criteria

- [ ] A 2xx S3 request increments `s3.requestCount` only; a 4xx/5xx increments
      `s3.errorCount` too (asserted by calling the interceptor with a mock
      `CallHandler`).
- [ ] An admin request classifies as `admin`; `isS3ThrottledRoute` decides the
      surface (no path re-parsing in the interceptor).
- [ ] `drain()` returns the accumulated counts and leaves both accumulators at
      zero; a subsequent `drain()` with no traffic returns zeros.
- [ ] `RequestMetricsService` is exported from `CommonModule` and injectable in
      `BackgroundModule`.

## Test obligations

- Unit: covered by [TEST-1102] (case 3).
- E2E: covered by [TEST-1102] (case 8 asserts the counts surface via the
  `/analytics/requests` endpoint after driving traffic).
- Conformance: N/A.

## Dependencies

- Blocked by: none. (Consumed by [TASK-3322].)

## References

- `libs/nestjs/src/lib/common/interceptors/shutdown-tracker.interceptor.ts`
  (global-interceptor pattern)
- `libs/nestjs/src/lib/s3/s3-throttle.ts` (`isS3ThrottledRoute` surface signal)
- `libs/nestjs/src/lib/common/common.module.ts` (global provider wiring)
- EPIC-08 [STORY-0705] (log/secret redaction — counts-only keeps this intact)
