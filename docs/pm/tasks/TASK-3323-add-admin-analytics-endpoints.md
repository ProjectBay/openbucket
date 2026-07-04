---
id: TASK-3323
title: Add the admin analytics module, controller, and nestjs-zod DTOs
story: STORY-1102
status: backlog
type: implementation
size: M
---

## Description

Expose the rolled-up samples through three read-only admin endpoints under
`api/admin/analytics`, following the `BucketsAdminController` pattern (thin
controller over a service, nestjs-zod `createZodDto` DTOs, `@ApiOperation`
operation IDs so the OpenAPI export drives the generated client). Add
`AnalyticsService` to query + server-side-downsample the series, register the
new module in `ADMIN_CONTROLLER_MODULES` and the host `RouterModule` children.

## Files to create / modify

- `libs/nestjs/src/lib/admin/analytics/analytics.controller.ts` — new
- `libs/nestjs/src/lib/admin/analytics/analytics.service.ts` — new
- `libs/nestjs/src/lib/admin/analytics/analytics-admin.module.ts` — new
- `libs/nestjs/src/lib/admin/analytics/dto/storage-series.dto.ts` — new
- `libs/nestjs/src/lib/admin/analytics/dto/bucket-breakdown.dto.ts` — new
- `libs/nestjs/src/lib/admin/analytics/dto/request-series.dto.ts` — new
- `libs/nestjs/src/lib/admin/analytics/dto/analytics-query.dto.ts` — new
- `libs/nestjs/src/lib/admin/admin.module.ts` — modify (add module to
  `ADMIN_CONTROLLER_MODULES`)
- `libs/nestjs/src/lib/open-bucket.module.ts` — modify only if the router lists
  modules individually (it spreads `ADMIN_CONTROLLER_MODULES`, so usually no edit)

## Implementation notes

- **Controller** — copy the `@Controller('api/admin/analytics')` shape from
  `buckets-admin.controller.ts`; **no `@Public()`**, so the global `JwtAuthGuard`
  (EPIC-08 [STORY-0700], fail-closed/case-insensitive) authenticates every route,
  and the `default` throttler (100/min) applies since it is not an
  `@S3Throttled` controller. These are `GET`s → not audited (per
  `audit.service.ts`, read-only calls are intentionally not in the catalogue).
  ```ts
  @Get('storage')  @ApiOperation({ operationId: 'getStorageAnalytics' })
  @ApiOkResponse({ type: StorageSeriesDto })
  getStorage(@Query() q: AnalyticsQueryDto): Promise<StorageSeriesDto>

  @Get('buckets')  @ApiOperation({ operationId: 'getBucketBreakdown' })
  @ApiOkResponse({ type: BucketBreakdownDto })
  getBuckets(): Promise<BucketBreakdownDto>

  @Get('requests') @ApiOperation({ operationId: 'getRequestAnalytics' })
  @ApiOkResponse({ type: RequestSeriesDto })
  getRequests(@Query() q: AnalyticsQueryDto): Promise<RequestSeriesDto>
  ```
- **DTOs (nestjs-zod)** — `createZodDto(z.object(...))` with `.meta({ id })` for
  named components, exactly like `bucket-summary.dto.ts`:
  - `AnalyticsQuerySchema`: `{ range: z.enum(['1h','24h','7d','30d','90d'])
    .default('7d'), bucket: z.string().max(63).optional() }` — the **allow-list
    enum is the DoS guard**: no free-form window, so no unbounded scan.
  - `StorageSeriesSchema`: `{ points: z.array(z.object({ t: z.string().datetime(),
    sizeBytes: z.number().int().nonnegative(), objectCount: z.number().int()
    .nonnegative() })), bucket: z.string().nullable() }`.
  - `BucketBreakdownSchema`: `{ buckets: z.array(z.object({ name, sizeBytes,
    objectCount, sharePct: z.number().min(0).max(100) })), totalSizeBytes,
    totalObjectCount }`.
  - `RequestSeriesSchema`: `{ points: z.array(z.object({ t, admin: z.object(
    { requestCount, errorCount }), s3: z.object({ requestCount, errorCount }) })) }`.
- **`AnalyticsService`** — QueryBuilder reads over the sample tables (inject the
  `EntityManager` via `@InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT)`):
  - **storage series**: filter `usage_samples` by `sampledAt >= now - rangeMs`
    (map the enum → ms). If `bucket` given, filter `bucketName = bucket`
    (**exact equality, not LIKE** — sidesteps the LIKE-metachar concern from
    EPIC-08 [STORY-0706]); else `GROUP BY sampledAt, sum(sizeBytes),
    sum(objectCount)` for the instance total. **Server-side downsample** to
    `<= MAX_POINTS = 500`: pick every `ceil(rows/500)`-th sampledAt bucket so a
    90-day range never streams thousands of points to the browser (DoS/bandwidth
    guard). Sizes read back via `Number(...)` (bigint affinity).
  - **breakdown**: latest `sampledAt` per still-existing bucket — join/filter the
    most-recent sample against `BucketService.list()` so a deleted bucket's stale
    samples are excluded; compute `sharePct = size/total*100`.
  - **request series**: window-filter `request_metric_samples`, pivot the two
    surfaces per `sampledAt`, downsample identically.
- **Module** — `@Module({ imports: [DomainModule], controllers:
  [AnalyticsController], providers: [AnalyticsService] })`, mirroring
  `buckets-admin.module.ts`. Add it to the `ADMIN_CONTROLLER_MODULES` array in
  `admin.module.ts`; because `open-bucket.module.ts` spreads that array into the
  `RouterModule` children, the routes mount under `<mountPath>/api/admin/analytics`
  automatically (the array's doc-comment explains why listing the module here is
  required).
- **Edge cases** — no samples yet → empty `points`/`buckets` arrays (200, not
  404); the frontend renders an empty state. `range` beyond retention simply
  returns whatever exists. Endpoints are pure reads → safe to call on the
  dashboard's polling interval.
- **Delivery** — the new `operationId`s appear in the OpenAPI export;
  regenerating via `nx run api-client:generate` produces an `AnalyticsService`
  in `@openbucket/api-client` for [TASK-3324]. The `git diff --exit-code` gate in
  `api-client/project.json` means the regenerated client must be committed.

## Acceptance criteria

- [ ] `GET /api/admin/analytics/storage?range=7d` returns `<= 500` points sorted
      by `t`, and `?bucket=<name>` restricts to that bucket via exact match.
- [ ] `GET /api/admin/analytics/buckets` sums `sizeBytes` to `totalSizeBytes` and
      excludes deleted buckets; `sharePct` values sum to ~100 (±rounding).
- [ ] `GET /api/admin/analytics/requests?range=24h` returns per-surface counts.
- [ ] All three return `401` without a bearer token (JwtAuthGuard) and an invalid
      `range` returns `400` from the zod pipe.
- [ ] The OpenAPI export contains `getStorageAnalytics`, `getBucketBreakdown`,
      `getRequestAnalytics`, and the regenerated api-client compiles.

## Test obligations

- Unit: covered by [TEST-1102] (case 6 — downsample/aggregation logic).
- E2E: covered by [TEST-1102] (cases 7–9 — authz, shapes, empty state).
- Conformance: N/A.

## Dependencies

- Blocked by: [TASK-3320], [TASK-3322].

## References

- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.ts`,
  `dto/bucket-summary.dto.ts`, `dto/list-buckets-response.dto.ts`,
  `buckets-admin.module.ts`
- `libs/nestjs/src/lib/admin/admin.module.ts` (`ADMIN_CONTROLLER_MODULES`,
  `JwtAuthGuard`, throttler), `libs/nestjs/src/lib/open-bucket.module.ts`
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` (reads not audited),
  `libs/nestjs/src/lib/s3/s3-throttle.ts` (`@S3Throttled` — analytics is NOT)
- EPIC-08 [STORY-0700] (auth), [STORY-0704] (limits), [STORY-0706] (no LIKE)
- `libs/api-client/project.json` (client regeneration + staleness gate)
