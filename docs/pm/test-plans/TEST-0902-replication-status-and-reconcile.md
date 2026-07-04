---
id: TEST-0902
title: Replication status aggregation and reconcile backfill
covers: [STORY-0902, TASK-2720, TASK-2721, TASK-2722, TASK-2723]
status: backlog
level: integration
---

## Goal

Verify that the replication status read model reports accurate lag/depth/error,
that the admin surface is authenticated and single-flight, and that a reconcile
job correctly and idempotently backfills objects missing on the remote — without
regressing the EPIC-08 security posture (auth gate, no credential leakage,
bounded/single-flight remote load).

## Setup

- MikroORM on `:memory:` libsql with the schema built via `orm.schema.createSchema()`
  (the pattern in `persistence/*.spec.ts`), including the [STORY-0900]
  `ReplicationOutbox` and the [TASK-2722] `ReconcileJob` entities.
- A fake `Clock` (existing `TestClock`) to pin `oldestPendingAgeMs`.
- A stub S3 target: `ListObjectsV2Command` responses served from an in-test
  `Map<bucket, Set<key>>`; a spy `ReplicationService.enqueue`.
- Nest testing module for controller cases; a mocked `ReplicationAdminService` for
  the Angular signal-store case (`nx test openbucket-frontend`).
- Framework: jest + supertest (backend), Angular TestBed (frontend).

## Cases

### Read model — TASK-2720
1. Given an unconfigured instance (no target), when `getStatus()`, then
   `enabled === false`, all counts `0`, `oldestPendingAgeMs === null`,
   `lastError === null`, and no throw.
2. Given outbox rows across two buckets with mixed `pending`/`inflight`/`failed`
   statuses and a pinned clock, when `getStatus()`, then instance counts equal the
   GROUP-BY totals, `oldestPendingAgeMs` equals `now - min(pending.createdAt)`, and
   `perBucket[]` splits correctly.
3. Given a failed outbox row whose `lastError` mentions the remote, when
   `getStatus()`, then the returned `lastError` contains only
   `{ message, at, bucket?, key? }` and no remote endpoint/credential string
   (assert against the target-config values).
4. Given a large fixture, assert the service issues COUNT aggregates and never
   materializes all rows (spy on `find`/query builder).

### Admin surface — TASK-2721
5. `GET /api/admin/replication/status` without a JWT → `401`; with a valid admin
   JWT → `200` and a body matching `ReplicationStatusDto`.
6. `POST /api/admin/replication/reconcile` with a running job present → `409`; with
   none → `202` and a `ReconcileJobDto` in `queued` state.
7. OpenAPI export contains `operationId`s `getReplicationStatus`, `startReconcile`,
   `getReconcileJob`.
8. An accepted reconcile emits a `replication.reconcile.started` audit record with
   `subject`/`jobId` and no remote-target fields.

### Reconcile engine — TASK-2722
9. Single-flight: two concurrent `ReconcileService.start()` calls → exactly one
   `queued` job persisted; the other throws `ConflictException`.
10. Backfill correctness: local bucket has M objects, remote stub has M−N of them;
    after the runner drains the job, `missingRequeued === N`, `localScanned === M`,
    `enqueue` was called exactly N times with the N missing keys, and job
    `state === 'completed'`.
11. Idempotency: re-running reconcile after the outbox drains requeues 0
    (`missingRequeued === 0`).
12. Key encoding: local keys containing `/`, a UTF-8 char, and a `%`-escape are
    compared to the remote via `decodeKey` and are neither missed nor
    double-requeued.
13. Bounded/resumable: with objects > `BATCH_SIZE * MAX_BATCHES_PER_TICK`, the job
    spans multiple ticks via the persisted `cursorBucket`/`cursorKey`, and no single
    tick loads the whole bucket into memory.
14. Remote failure: when the stub `ListObjectsV2` throws, the job ends
    `state === 'failed'` with an `error` message containing no endpoint/credential
    text, and `GET /status` still returns `200`.

### Console page — TASK-2723
15. The signal store `refresh()` populates `status()` from a mocked
    `getReplicationStatus`; `reconcile()` calls `startReconcile`, polls
    `getReconcileJob` to `completed`, then re-refreshes status. When
    `status().enabled === false`, the component shows the not-configured panel.

## Tooling

- Framework: jest | supertest | @aws-sdk/client-s3 (stubbed) | Angular TestBed
- Runner: `nx test nestjs`, `nx test openbucket-frontend`, `nx run openbucket-backend:openapi:export`

## Pass criteria

- [ ] All cases above pass.
- [ ] No test asserts a remote endpoint/credential appears in any DTO, audit line, or job error.
- [ ] `nx run api-client:check` is green (client byte-equal after regen).

## References

- `libs/nestjs/src/lib/persistence/repositories.spec.ts` (`:memory:` + `createSchema()` harness)
- `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts` (batching invariants under test)
- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.spec.ts` (controller test pattern)
- `libs/nestjs/src/lib/storage/key-codec.spec.ts` (key round-trip fixtures)
</content>
