---
id: TASK-2722
title: Implement the bounded reconcile/backfill job runner
story: STORY-0902
status: backlog
type: implementation
size: L
---

## Description

Implement the reconcile/backfill engine: a `ReconcileService` that starts a
single-flight job and a `ReconcileRunner` `ScheduledTask` that executes it —
paging local objects, diffing them against `ListObjectsV2` on the remote S3
target, and re-enqueuing any object missing (or divergent) on the remote back into
the `replication_outbox` via `ReplicationService.enqueue`. The job is durable
(survives restart), bounded, and never blocks a request thread.

## Files to create / modify

- `libs/nestjs/src/lib/domain/replication/reconcile.service.ts` — new (start / single-flight / job state)
- `libs/nestjs/src/lib/common/background/reconcile.runner.ts` — new (`ScheduledTask` that drains queued jobs)
- `libs/nestjs/src/lib/persistence/entities/reconcile-job.entity.ts` — new
- `libs/nestjs/src/lib/persistence/index.ts` — modify (export the new entity)
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify (register runner in providers + `SCHEDULED_TASKS` factory `inject`)
- `libs/nestjs/src/lib/domain/replication/reconcile.service.spec.ts` — new
- `libs/nestjs/src/lib/common/background/reconcile.runner.spec.ts` — new

## Implementation notes

- **Job state entity** `ReconcileJob` (persisted so a job survives a restart and
  the UI can poll it): `id (uuidv7 pk)`, `scope ('instance'|'bucket')`, `bucket?`,
  `state ('queued'|'running'|'completed'|'failed')`, `localScanned`,
  `remoteScanned`, `missingRequeued`, `cursorBucket?`, `cursorKey?` (resume point),
  `startedAt`, `finishedAt?`, `error?`, `createdAt`. Schema is created from
  entities (this repo builds schema via `orm.schema.createSchema()`; add to the
  STORY-0205 initial migration set / entity discovery in `persistence/index.ts` —
  no standalone migrations dir exists).
- **Single-flight** (`ReconcileService.start`): in one transaction, reject with
  `ConflictException` if any job is `queued`/`running`; else insert a `queued` row
  and return it. This is the DoS guard — at most one remote-listing scan at a time,
  regardless of throttler.
  ```ts
  @Injectable()
  export class ReconcileService {
    async start(input: { scope: 'instance'|'bucket'; bucket?: string; subject: string }): Promise<ReconcileJob>;
    async get(jobId: string): Promise<ReconcileJob | null>;
    async activeJob(): Promise<ReconcileJob | null>;
  }
  ```
- **Runner** (`ReconcileRunner implements ScheduledTask`, `intervalMs = 5_000`):
  each tick, pick the oldest `queued`/`running` job (there is at most one), mark it
  `running`, and process a bounded slice:
  - Local side: reuse `ObjectService.list` / the same `ObjectRepository.listByPrefix`
    indexed range-scan `LifecycleSweepRunner` uses, page by `(bucket, afterKey)` in
    `BATCH_SIZE` (e.g. 500) chunks, capped at `MAX_BATCHES_PER_TICK` (e.g. 10) so a
    huge bucket resumes next tick via `cursorBucket`/`cursorKey` — never hold the EM
    open across a full scan; `await new Promise(r => setImmediate(r))` between batches.
  - Remote side: use `@aws-sdk/client-s3` `ListObjectsV2Command` against the target
    (client factory from [STORY-0900]) with matching `Prefix`/`StartAfter`, into a
    `Set<string>` window; compare by **decoded S3 key** — decode local
    filenames/keys with `decodeKey` from `storage/key-codec` so `/`, UTF-8, and
    `%XX` keys line up with the remote object keys and are not double-counted.
  - For each local key absent (or with a differing size/etag) on the remote, call
    `ReplicationService.enqueue({ bucket, key, op: 'PUT' })` (idempotent — STORY-0900
    dedupes an already-pending intent) and increment `missingRequeued`.
  - Persist counters + cursor after each batch. On completion set
    `state='completed'`, `finishedAt`; on unhandled remote error set
    `state='failed'`, store a **redacted** `error` message (no endpoint/creds),
    with backoff-safe behaviour (a failed remote list marks the job failed rather
    than looping forever).
  - Emit `replication.reconcile.completed` audit event with `subject`, `jobId`,
    `localScanned`, `remoteScanned`, `missingRequeued`.
- The runner runs inside the scheduler's per-tick `RequestContext` (identity map
  isolation) and respects no-pile-up automatically (`BackgroundService.fire`).
- **Edge cases:** remote unreachable → job `failed`, status endpoint still serves;
  reconcile of a bucket deleted mid-scan → finish gracefully; delete-only divergence
  (object exists remotely but not locally) is **out of scope** in v1 (one-way
  local→remote, matching EPIC-10 scope) — count it under `remoteScanned` but do not
  delete remotely; empty remote (fresh target) → every local object requeued.

## Acceptance criteria

- [ ] `nx test nestjs --testFile=reconcile.service.spec.ts` and `--testFile=reconcile.runner.spec.ts` pass.
- [ ] Concurrent `start()` calls yield exactly one `queued` job; the loser throws `ConflictException`.
- [ ] With a stub remote missing N of M local objects, one full run sets `missingRequeued === N`, `localScanned === M`, and enqueues N outbox intents; a re-run after drain requeues 0 (idempotent).
- [ ] A run over > `BATCH_SIZE * MAX_BATCHES_PER_TICK` objects spans multiple ticks via the persisted cursor and never loads the whole bucket into memory.
- [ ] Keys with `/`, UTF-8, and `%`-escapes are matched via `decodeKey` and not double-requeued.
- [ ] A remote-list failure sets `state='failed'` with a message containing no endpoint/credential text.

## Test obligations

- Unit: covered by [TEST-0902] (single-flight, diff/idempotency, key-codec, cursor resume)
- E2E: covered by [TEST-0902] (start → poll → completed via controller)
- Conformance: N/A

## Dependencies

- Blocked by: [STORY-0900] (`ReplicationService.enqueue`, `replication_outbox`, target S3 client factory)

## References

- `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts` (batching, cursor, `setImmediate` yield, `BATCH_SIZE`/`MAX_BATCHES_PER_TICK`)
- `libs/nestjs/src/lib/common/background/background.module.ts` (register runner + `SCHEDULED_TASKS` factory)
- `libs/nestjs/src/lib/storage/key-codec.ts` (`decodeKey`)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` (`scanForLifecycle` / `list` range-scan)
- `libs/nestjs/src/lib/persistence/index.ts` (entity discovery barrel)
- `@aws-sdk/client-s3` `ListObjectsV2Command` (already in `package.json`)
</content>
