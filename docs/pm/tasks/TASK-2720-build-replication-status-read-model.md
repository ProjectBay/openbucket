---
id: TASK-2720
title: Build the replication status read-model service and DTOs
story: STORY-0902
status: backlog
type: implementation
size: M
---

## Description

Add a `ReplicationStatusService` that aggregates the durable `replication_outbox`
(from [STORY-0900]) into an operator-facing read model: whether replication is
enabled, pending/inflight/failed counts, the replication lag (age of the oldest
pending intent), the last error, and a per-bucket breakdown. Expose the shape as
nestjs-zod DTOs so the generated client emits shared models. Pure read + aggregate
— no writes, no remote calls.

## Files to create / modify

- `libs/nestjs/src/lib/domain/replication/replication-status.service.ts` — new
- `libs/nestjs/src/lib/domain/replication/replication-status.service.spec.ts` — new
- `libs/nestjs/src/lib/admin/replication/dto/replication-status.dto.ts` — new
- `libs/nestjs/src/lib/domain/domain.module.ts` — modify (provide + export `ReplicationStatusService`)

## Implementation notes

- Read the outbox via the MikroORM EntityManager for `OPEN_BUCKET_ORM_CONTEXT`
  (`@InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT)`), same as `LifecycleSweepRunner`.
  Prefer SQL `COUNT(*) ... GROUP BY status, bucket` aggregates over loading rows —
  the outbox can be large; never `find()` the whole table.
- Service surface:
  ```ts
  export interface BucketReplicationStatus {
    bucket: string;
    pendingCount: number;
    inflightCount: number;
    failedCount: number;
    oldestPendingAgeMs: number | null; // null when nothing pending
  }
  export interface ReplicationStatus {
    enabled: boolean;               // target configured (from STORY-0900 config)
    pendingCount: number;
    inflightCount: number;
    failedCount: number;
    oldestPendingAgeMs: number | null;
    lastError: { message: string; at: string; bucket?: string; key?: string } | null;
    perBucket: BucketReplicationStatus[];
  }
  @Injectable()
  export class ReplicationStatusService {
    async getStatus(): Promise<ReplicationStatus>;
    async getBucketStatus(bucket: string): Promise<BucketReplicationStatus>;
  }
  ```
- `enabled` comes from the resolved replication target config produced by
  [STORY-0900] (inject its config/service token); when unconfigured, return zeroed
  counters and `enabled: false` (do NOT throw — the endpoint must 200).
- Lag: `oldestPendingAgeMs = now - min(createdAt) WHERE status='pending'`, read the
  clock via the existing `Clock` abstraction so tests can pin time.
- `lastError`: newest row with a non-null `lastError`, projecting only
  `{ message, at, bucket, key }`. **Redaction:** never surface remote endpoint,
  bucket, or credentials from the target config in `lastError` — only the outbox
  row's own message/coordinates. Truncate `message` to a bounded length.
- DTOs mirror the interfaces with `createZodDto` + `.meta({ id })` on nested items
  (`BucketReplicationStatusDto`, `ReplicationStatusDto`) exactly like
  `list-objects-response.dto.ts`'s `ObjectListItem`, so codegen shares them.

## Acceptance criteria

- [ ] `nx test nestjs --testFile=replication-status.service.spec.ts` passes.
- [ ] `getStatus()` on an empty/unconfigured instance returns `enabled:false` and all-zero counters without throwing.
- [ ] Counts and `oldestPendingAgeMs` are computed via GROUP-BY aggregates, not by materializing outbox rows (asserted by a spy/large-fixture test).
- [ ] `lastError` never contains any field sourced from the remote target config.

## Test obligations

- Unit: covered by [TEST-0902] (aggregation cases)
- E2E: covered by [TEST-0902] (via the controller in [TASK-2721])
- Conformance: N/A

## Dependencies

- Blocked by: [STORY-0900] (`ReplicationOutbox` entity + resolved target config)

## References

- `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts` (EM injection + clock)
- `libs/nestjs/src/lib/admin/objects/dto/list-objects-response.dto.ts` (`.meta({ id })` shared models)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` (`statsFor` aggregate pattern)
</content>
