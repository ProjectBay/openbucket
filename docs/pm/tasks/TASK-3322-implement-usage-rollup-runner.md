---
id: TASK-3322
title: Implement the usage-rollup background runner with retention pruning
story: STORY-1102
status: backlog
type: implementation
size: M
---

## Description

Add `UsageRollupRunner implements ScheduledTask`: every
`AppConfigService.usageRollupIntervalMs` (default 15 min) it snapshots per-bucket
storage via `ObjectRepository.aggregateByBucket()` ([TASK-3320]), drains the
request-metrics accumulators ([TASK-3321]), writes both sets of samples with a
single shared `sampledAt`, and prunes rows older than
`AppConfigService.usageRetentionDays` (default 90) to bound table growth. Add the
two config knobs and register the runner in the background module.

## Files to create / modify

- `libs/nestjs/src/lib/common/background/usage-rollup.runner.ts` — new
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify (add to
  `providers` **and** the `SCHEDULED_TASKS` factory `inject` list; import
  `CommonModule`/`RequestMetricsService` and `PersistenceModule` entities are
  global)
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (add
  `USAGE_ROLLUP_INTERVAL_MS`, `USAGE_RETENTION_DAYS` with zod defaults)
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify (expose
  `usageRollupIntervalMs`, `usageRetentionDays` getters)

## Implementation notes

- **Shape** — mirror `lifecycle-sweep.runner.ts` / `multipart-cleanup.runner.ts`:
  ```ts
  @Injectable()
  export class UsageRollupRunner implements ScheduledTask {
    readonly name = 'usage-rollup';
    get intervalMs() { return this.config.usageRollupIntervalMs; } // config-driven
    constructor(
      @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
      private readonly buckets: BucketService,
      private readonly metrics: RequestMetricsService,
      private readonly config: AppConfigService,
      private readonly clock: Clock,
    ) {}
    async run(): Promise<void> { /* sample → persist → prune */ }
  }
  ```
  `intervalMs` is read once by the scheduler at `onApplicationBootstrap`; a
  getter that returns the config value is fine (the scheduler snapshots it into
  the `setInterval`).
- **Sampling** — `const sampledAt = new Date(this.clock.nowMs());` (read the
  `Clock` so `TEST-1102` can fast-forward, exactly like the other runners). Build
  a `Map<bucket, {objectCount,sizeBytes}>` from `aggregateByBucket()`, then
  iterate `buckets.list()` (all existing buckets) so empty buckets record `0/0`.
  Persist in one transaction:
  ```ts
  await this.em.transactional(async (em) => {
    for (const b of allBuckets) em.create(UsageSample, { id: uuidv7(), bucketName: b.name,
      sampledAt, ...(agg.get(b.name) ?? { objectCount: 0, sizeBytes: 0n }) });
    const drained = this.metrics.drain();
    for (const surface of ['admin','s3'] as const)
      em.create(RequestMetricSample, { id: uuidv7(), sampledAt, surface,
        windowMs: this.intervalMs, ...drained[surface] });
  });
  ```
  Draining the metrics **inside** the same tick that persists them keeps the
  window aligned; a crash between drain and commit loses at most one window
  (acceptable — best-effort telemetry, unlike durability-critical object writes).
- **Retention prune** — after persisting, delete expired rows in the same tick:
  ```ts
  const cutoff = new Date(this.clock.nowMs() - this.config.usageRetentionDays * 864e5);
  await em.nativeDelete(UsageSample, { sampledAt: { $lt: cutoff } });
  await em.nativeDelete(RequestMetricSample, { sampledAt: { $lt: cutoff } });
  ```
  `nativeDelete` (set-based) avoids hydrating rows. This is the sole bound on
  table growth — an EPIC-08-style resource limit ([STORY-0704]) applied to the
  telemetry surface.
- **Registration** — the module doc-comment in `background.module.ts` is explicit:
  add the runner to BOTH `providers` and the `SCHEDULED_TASKS` `useFactory`
  `inject` array, or it is constructed but never scheduled. `BucketService`
  comes from `DomainModule` (already imported); `RequestMetricsService` from
  `CommonModule` (add the import + ensure it is exported per [TASK-3321]).
- **Config** — add `USAGE_ROLLUP_INTERVAL_MS` (`z.coerce.number().int().min(60000)
  .default(900000)`) and `USAGE_RETENTION_DAYS` (`.int().min(1).default(90)`) to
  the zod env schema, following the existing `MULTIPART_TTL_HOURS` /
  `S3_THROTTLE_*` knobs, and surface them as `AppConfigService` getters.
- **Edge cases** — no buckets → writes only the two request-metric rows (still
  useful). BackgroundService already skips a tick while the previous is in-flight
  and runs each tick in a fresh `RequestContext`, so identity maps never leak.
  A minimum interval of 60 s in the schema prevents a misconfig from hammering
  the DB (DoS self-inflicted). Sampling is O(objects) once per tick (one grouped
  aggregate), not O(buckets) queries.

## Acceptance criteria

- [ ] With a fixed `Clock` and seeded buckets/objects, one `run()` inserts one
      `usage_samples` row per bucket (incl. empty buckets as `0/0`) sharing one
      `sampledAt`, plus one `request_metric_samples` row per surface.
- [ ] A second `run()` after advancing the `Clock` past `usageRetentionDays`
      prunes the first batch (`nativeDelete`) while keeping the new one.
- [ ] `metrics.drain()` is called exactly once per tick and its counts land in
      the persisted `request_metric_samples` rows.
- [ ] The runner appears in both `providers` and the `SCHEDULED_TASKS` factory
      inject list, and `nx test nestjs` background-module wiring test passes.

## Test obligations

- Unit: covered by [TEST-1102] (cases 4–5).
- E2E: N/A (endpoint-level coverage is cases 6–8).
- Conformance: N/A.

## Dependencies

- Blocked by: [TASK-3320], [TASK-3321].

## References

- `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts`,
  `multipart-cleanup.runner.ts`, `background.module.ts`, `background.service.ts`
- `libs/nestjs/src/lib/common/config/app-config.service.ts` (config-getter pattern)
- `libs/nestjs/src/lib/domain/buckets/bucket.service.ts` (`list` / `listWithStats`)
- EPIC-08 [STORY-0704] (resource limits — retention prune bounds the surface)
