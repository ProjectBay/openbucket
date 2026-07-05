---
id: TASK-3621
title: Emit HTTP request counter and latency histogram by extending the request-metrics interceptor
story: STORY-1202
status: backlog
type: implementation
size: M
---

## Description

Extend the existing EPIC-12 `RequestMetricsInterceptor` so that, in addition to its
in-memory `RequestMetricsService.record(surface, status)`, it also increments the
`prom-client` HTTP request counter and observes the request-latency histogram. This
reuses the single already-bound global interceptor rather than binding a second one,
so every request is instrumented exactly once and cardinality stays bounded.

## Files to create / modify

- `libs/nestjs/src/lib/common/interceptors/request-metrics.interceptor.ts` — modify (inject `PROM_METRICS`; start a timer, on completion record counter + histogram)
- `libs/nestjs/src/lib/common/metrics/route-class.ts` — new (pure `routeClass(ctx)` + `statusClass(code)` helpers, bounded label derivation)
- `libs/nestjs/src/lib/common/metrics/route-class.spec.ts` — new (label-cardinality unit tests)
- `libs/nestjs/src/lib/common/common.module.ts` — modify only if the interceptor's provider needs `PROM_METRICS` visible (it is `@Global`, so typically no change)

## Implementation notes

- The interceptor already computes `surface` via `isS3ThrottledRoute(context)` and reads
  `res.statusCode` (and `statusFromError` for the error path). Reuse both. Add a
  monotonic timer at `intercept()` entry:

  ```ts
  intercept(context, next) {
    const surface = isS3ThrottledRoute(context) ? 's3' : 'admin';
    const start = process.hrtime.bigint();
    const res = context.switchToHttp().getResponse<Response>();
    const method = context.switchToHttp().getRequest<Request>().method;
    const route_class = routeClass(context); // bounded: 'admin' | s3Scope ('s3-service'|'s3-bucket'|'s3-object')
    const done = (status: number) => {
      this.metrics.record(surface, status);                 // unchanged EPIC-12 path
      const labels = { surface, method, route_class, status_class: statusClass(status) };
      this.prom.httpRequestsTotal.inc(labels);
      this.prom.httpRequestDurationSeconds.observe(
        labels, Number(process.hrtime.bigint() - start) / 1e9);
    };
    return next.handle().pipe(tap({ next: () => done(res.statusCode),
                                    error: (e) => done(statusFromError(e)) }));
  }
  ```

- `route_class` MUST be a small bounded set (CWE-770 cardinality control): use
  `req.openbucket.s3Scope` for S3 (`s3-service|s3-bucket|s3-object`) and the constant
  `'admin'` for the admin surface. NEVER the raw URL, bucket name, or object key —
  matching the EPIC-08/STORY-0705 rule the in-memory service already follows ("only
  COUNTS are retained — never URLs, keys, or signatures").
- `status_class` collapses to `2xx|3xx|4xx|5xx` (5 buckets max incl. `1xx`) to bound
  the status dimension.
- `method` is the HTTP verb (already a bounded enum of ~7). Uppercase it defensively.
- Do NOT bind a new `APP_INTERCEPTOR`; the interceptor is already registered once in
  `common.module.ts`. Double-instrumentation is explicitly out of scope.
- Edge case: `/metrics` self-scrape — the scrape request itself flows through the
  interceptor and is counted (surface `admin`, `route_class` `admin`). This is expected
  and harmless (bounded). Do not special-case it.
- Edge case: streaming S3 GETs where the response status is set before the body streams —
  `res.statusCode` is already final at `tap` time (same timing the EPIC-12 path relies
  on), so latency measures header-to-completion; acceptable and documented.

## Acceptance criteria

- [ ] After N requests across admin + S3 surfaces, `openbucket_http_requests_total` sums to N with only the bounded label set present (no path/key/IP labels).
- [ ] `openbucket_http_request_duration_seconds_count` equals the request count and `_sum` is > 0; buckets are populated.
- [ ] No second `APP_INTERCEPTOR` is added; `grep` shows a single `RequestMetricsInterceptor` binding.
- [ ] `routeClass`/`statusClass` unit tests prove the label set is finite (≤ surfaces × methods × 4 s3Scopes × 4 status_classes).
- [ ] `nx test nestjs --testPathPattern=route-class` passes.

## Test obligations

- Unit: covered by [TEST-1202] (`route-class.spec.ts` cardinality + `statusClass` boundaries)
- E2E: covered by [TEST-1202] (counter/histogram totals after a request mix)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3620]
</content>
