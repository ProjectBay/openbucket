---
id: TASK-3622
title: Feed S3-operation, storage/object-count, and replication-depth metrics from the rollup tick
story: STORY-1202
status: backlog
type: implementation
size: M
---

## Description

Populate the remaining metric families: an S3-operation counter incremented per S3
request from the already-resolved `req.openbucket.operation`, and three gauges
(storage bytes, object count, replication-outbox depth) refreshed on the existing
`UsageRollupRunner` tick rather than recomputed on scrape. This reuses EPIC-12's
per-bucket aggregate and the EPIC-09 replication read model — no new query on the
hot scrape path.

## Files to create / modify

- `libs/nestjs/src/lib/common/interceptors/request-metrics.interceptor.ts` — modify (increment `s3OperationsTotal{operation}` when surface is `s3` and `req.openbucket.operation` is set)
- `libs/nestjs/src/lib/common/background/usage-rollup.runner.ts` — modify (after the existing per-bucket aggregate, `set` the storage/object-count gauges; call replication depth refresh)
- `libs/nestjs/src/lib/common/background/usage-rollup.runner.spec.ts` — modify (assert gauges are set + stale buckets evicted)
- `libs/nestjs/src/lib/common/metrics/gauge-refresher.ts` — new (small helper that reconciles a `Gauge<'bucket'>` set against the live bucket list, removing stale label series)

## Implementation notes

- S3-operation counter (in the interceptor from TASK-3621, no extra pass):

  ```ts
  const op = context.switchToHttp().getRequest<Request>().openbucket?.operation;
  if (surface === 's3' && op) this.prom.s3OperationsTotal.inc({ operation: op });
  ```

  `operation` is the bounded enum set by the `OperationDispatcherInterceptor` via
  `resolveS3Operation` (`libs/nestjs/src/lib/s3/routing/operation-resolver.ts`). When it
  is `undefined` (shape not a known operation) record NOTHING — do not synthesise an
  `unknown` label (avoids an attacker-driven unbounded-ish churn and keeps the family to
  the finite S3 op names).
- Storage/object-count gauges: the `UsageRollupRunner.run()` already builds
  `agg = ObjectRepository.aggregateByBucket()` (per-bucket `objectCount` + `sizeBytes`)
  and `allBuckets = buckets.list()`. After it writes the `UsageSample` rows, set gauges
  from the SAME in-memory data:

  ```ts
  const live = new Set(allBuckets.map((b) => b.name));
  reconcileGauge(this.prom.storageBytes, live, (name) => Number(agg.get(name)?.sizeBytes ?? 0n));
  reconcileGauge(this.prom.objectCount, live, (name) => agg.get(name)?.objectCount ?? 0);
  ```

  `reconcileGauge` calls `gauge.remove(label)` for any previously-set bucket no longer in
  `live` (cardinality tracks live buckets; a deleted bucket's series disappears — CWE-770).
  `sizeBytes` is a `bigint`; convert with `Number()` (Prometheus gauges are float64 —
  acceptable up to ~9 PB before precision loss, well beyond a single-node store; note in a
  comment).
- Replication depth: inject `ReplicationOutboxRepository` (or `ReplicationStatusService`)
  and, on the same tick, `set` `replicationOutboxDepth{status}` from `countByStatus()`
  → `{ pending, failed }` plus `inflight` (pending with `attempts>0`, per
  `ReplicationStatusService`). When `REPLICATION_CONFIG.enabled` is false, set all three to
  `0` and skip the query (the outbox is empty). This runs inside the tick's
  `RequestContext`, so the EM is valid.
- Reuse, don't duplicate: do NOT add a new scheduled runner — extend the existing
  `UsageRollupRunner` (already registered in `background.module.ts` providers + the
  `SCHEDULED_TASKS` factory `inject` list). The default 15-min tick is the gauge refresh
  cadence; document that gauges are eventually-consistent to `usageRollupIntervalMs`.
- Edge case: first scrape before the first tick — gauges read `0`/absent; acceptable, and
  the histogram/counters (TASK-3621) are live immediately.
- Security: no bucket credential/endpoint is ever a label; only the bucket NAME (already
  public in the admin API) and coarse counts.

## Acceptance criteria

- [ ] `openbucket_s3_operations_total{operation="PutObject"}` (etc.) increments on the matching S3 request and no series is created when `operation` is unset.
- [ ] After a rollup tick, `openbucket_storage_bytes{bucket=...}` and `openbucket_object_count{bucket=...}` match the `UsageSample` rows written in the same tick (same numbers).
- [ ] Deleting a bucket and running a tick removes its gauge series (`reconcileGauge` eviction) — verified in `usage-rollup.runner.spec.ts`.
- [ ] `openbucket_replication_outbox_depth{status="pending"|"inflight"|"failed"}` matches `countByStatus`; all `0` and no query issued when replication is disabled.
- [ ] `nx test nestjs --testPathPattern=usage-rollup` passes.

## Test obligations

- Unit: covered by [TEST-1202] (gauge reconciliation, stale-bucket eviction, disabled-replication zeroing)
- E2E: covered by [TEST-1202] (gauges + s3 op counter visible in the scrape after activity)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3620], [TASK-3621]
</content>
