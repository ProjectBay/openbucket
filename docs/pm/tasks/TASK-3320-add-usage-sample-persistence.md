---
id: TASK-3320
title: Add usage-sample persistence (entities, migration, grouped aggregate)
story: STORY-1102
status: backlog
type: infra
size: M
---

## Description

Add the storage layer the rollup writes to: two timestamped sample entities
(`UsageSample`, `RequestMetricSample`), a forward-only migration creating their
tables + indexes, and a single grouped aggregate on `ObjectRepository` that
returns per-bucket `{ bucket, objectCount, sizeBytes }` in one query so the
runner never does N+1 `statsFor` calls. Wire both entities into the two entity
registries (`mikro-orm.config.ts` and `persistence.module.ts`).

## Files to create / modify

- `libs/nestjs/src/lib/persistence/entities/usage-sample.entity.ts` — new
- `libs/nestjs/src/lib/persistence/entities/request-metric-sample.entity.ts` — new
- `libs/nestjs/src/lib/persistence/index.ts` — modify (export the two entities)
- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts` — modify
  (add `aggregateByBucket()`)
- `libs/nestjs/src/lib/migrations/Migration20260705000001_usage_samples.ts` — new
- `libs/nestjs/src/lib/mikro-orm.config.ts` — modify (add to `entities[]`)
- `libs/nestjs/src/lib/persistence.module.ts` — modify (add to `ENTITIES[]`)

## Implementation notes

- **`UsageSample`** — follow the `LifecycleState`/`ObjectEntity` decorator style
  (explicit MikroORM types, `ReflectMetadataProvider`-compatible):
  ```ts
  @Entity({ tableName: 'usage_samples' })
  @Index({ name: 'ix_usage_samples_sampled_at', properties: ['sampledAt'] })
  @Index({ name: 'ix_usage_samples_bucket_sampled', properties: ['bucketName', 'sampledAt'] })
  export class UsageSample {
    @PrimaryKey({ type: 'string' }) id!: string;            // uuid v7, service-generated
    @Property({ type: 'string', length: 63 }) bucketName!: string; // NOT an FK — see below
    @Property({ type: 'datetime' }) sampledAt!: Date;
    @Property({ type: 'bigint' }) sizeBytes = 0n;
    @Property({ type: 'integer' }) objectCount = 0;
  }
  ```
  `bucketName` is a **plain column, not a `@ManyToOne` FK to `buckets`** (unlike
  `LifecycleState`): a bucket delete must not `cascade`-erase its historical
  samples, or the instance storage-over-time line would retroactively drop. The
  breakdown endpoint filters to still-existing buckets at read time
  ([TASK-3323]); the storage series sums across all rows.
- **`RequestMetricSample`** — `{ id, sampledAt: Date, surface: 'admin'|'s3',
  windowMs: number, requestCount: integer, errorCount: integer }`, indexed on
  `sampledAt`. `errorCount` counts `>= 400` responses (4xx + 5xx). Store
  `windowMs` so a rate = `count / (windowMs/1000)` is reconstructable even if the
  tick interval changes.
- **`ObjectRepository.aggregateByBucket()`** — mirror `ObjectService.statsFor`'s
  QueryBuilder raw aggregate but grouped, so the whole instance is one query:
  ```ts
  async aggregateByBucket(): Promise<{ bucket: string; objectCount: number; sizeBytes: number }[]> {
    const rows = await this.getEntityManager()
      .createQueryBuilder(ObjectEntity, 'o')
      .select([raw('o.bucket_name as bucket'),
               raw('count(*) as objectCount'),
               raw('coalesce(sum(o.size), 0) as sizeBytes')])
      .where({ softDeleted: false })
      .groupBy('o.bucket_name')
      .execute('all');
    return rows.map((r) => ({ bucket: String(r.bucket),
      objectCount: Number(r.objectCount), sizeBytes: Number(r.sizeBytes) }));
  }
  ```
  Buckets with zero live objects won't appear — the runner seeds them from the
  bucket list so an empty bucket still records a `0/0` sample.
- **Migration** — copy the shape of
  `Migration20260701000001_object_content_sha256.ts` (forward-only, `up()` +
  test-only `down()`); `create table` for both tables + the three indexes.
  `bigint`→`integer` affinity in SQLite; sizes read back through `Number(...)`.
- **Registration** — both new registries are explicit (no glob): add
  `UsageSample`/`RequestMetricSample` to the `entities[]` in `mikro-orm.config.ts`
  **and** the `ENTITIES[]` in `persistence.module.ts`, or MikroORM discovery
  fails at boot. No repository provider is needed (the runner uses
  `em.fork()` / QB directly, like `MultipartCleanupRunner`).
- **Security / DoS** — the tables are the only unbounded growth surface; growth
  is bounded by the retention prune in [TASK-3322]. All writes are parameterized
  QB/entities (no string interpolation) — no SQLi, consistent with EPIC-08.

## Acceptance criteria

- [ ] `nx test nestjs` migration spec runs the new migration up+down cleanly and
      the tables/indexes exist (assert via `select name from sqlite_master`).
- [ ] `aggregateByBucket()` returns one row per bucket with live objects, with
      `objectCount`/`sizeBytes` equal to `statsFor` for that bucket.
- [ ] Both entities are present in `mikro-orm.config.ts` and `persistence.module.ts`
      `ENTITIES`, and the app boots (`getMigrator().up()` succeeds).

## Test obligations

- Unit: covered by [TEST-1102] (cases 1–2).
- E2E: N/A — exercised transitively by the endpoint cases in [TEST-1102].
- Conformance: N/A.

## Dependencies

- Blocked by: none.

## References

- `libs/nestjs/src/lib/persistence/entities/lifecycle-state.entity.ts`,
  `object.entity.ts` (entity/decorator style)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` (`statsFor` raw aggregate)
- `libs/nestjs/src/lib/migrations/Migration20260701000001_object_content_sha256.ts`
- `libs/nestjs/src/lib/mikro-orm.config.ts`, `libs/nestjs/src/lib/persistence.module.ts`
