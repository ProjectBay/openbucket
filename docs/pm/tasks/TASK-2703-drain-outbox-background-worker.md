---
id: TASK-2703
title: Drain the outbox in a background worker with ordering, backoff, and dead-letter
story: STORY-0900
status: backlog
type: implementation
size: L
---

## Description

Add the `ReplicationWorkerRunner` — a `ScheduledTask` on the existing §4.9 tick —
that drains `replication_outbox` to the remote target. It preserves per-key
ordering, coalesces superseded intents (last-writer-wins per key), retries failed
intents with exponential backoff, and dead-letters after `maxAttempts`. Because
intents are already durable, the drain simply resumes on boot with no special
recovery step.

## Files to create / modify

- `libs/nestjs/src/lib/common/background/replication.runner.ts` — new (`ReplicationWorkerRunner implements ScheduledTask`)
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify (add provider + `SCHEDULED_TASKS` factory `inject` entry)
- `libs/nestjs/src/lib/common/background/replication.runner.spec.ts` — new (unit)
- `libs/nestjs/src/lib/storage/replication/replication.module.ts` — modify (export target service to BackgroundModule)

## Implementation notes

- Shape mirrors `LifecycleSweepRunner` (batched, cursor-bounded, yields between
  batches, reads `Clock` so tests fast-forward backoff):
  ```ts
  @Injectable()
  export class ReplicationWorkerRunner implements ScheduledTask {
    readonly name = 'replication-drain';
    readonly intervalMs = this.config.drainIntervalMs; // default 5000
    async run(): Promise<void> { … }
  }
  ```
- Gating: if `!config.enabled` the runner is either not registered or `run()` is a
  no-op — the tick "schedules nothing" per the story AC. Prefer registering it
  always and early-returning, matching how other runners are unconditionally in
  the `SCHEDULED_TASKS` factory.
- Drain algorithm (per tick, inside the tick's `RequestContext`):
  1. `keys = repo.dueKeys(clock.now(), config.batchKeys)` — distinct due keys,
     bounds per-tick work (like `MAX_BATCHES_PER_TICK`).
  2. For each key, process its chain with **bounded concurrency** across distinct
     keys (e.g. `p-limit`-style, or a simple `Promise.all` over the batch — keys
     are independent, so cross-key parallelism is safe; within a key it is
     strictly serial). The no-pileup guard in `BackgroundService.fire` guarantees
     only one tick runs at a time, so no cross-tick double-claim; a single process
     means no in-memory claim table is needed.
  3. Per key: `chain = repo.pendingForKey(bucket, key)` ordered by `seq ASC`.
     **Coalesce**: only the *last* intent in the chain determines the remote
     state. Mark every earlier intent `done` (superseded) and act on the last:
     - last `op='PUT'`: read current bytes via
       `ObjectService.openObjectStream(bucket, key)` (decrypts SSE → plaintext),
       then `target.putObject({ key, body: stream, contentLength: size,
       contentType, metadata })`. If `openObjectStream` returns `null` (object was
       since deleted) treat as a no-op success — a later DELETE intent will carry
       the real state, or the object is simply gone.
     - last `op='DELETE'`: `target.deleteObject(key)` (idempotent — a 404 on the
       remote is success).
  4. On success mark the acted intent `done`; **immediately delete** all `done`
     rows for the key (retention: keep the table small; STORY-0902 can add a
     configurable keep-window if history is wanted).
  5. On failure: `attempts += 1`; if `attempts >= config.maxAttempts` set
     `status='failed'` (dead-letter, left for STORY-0902 reconcile); else keep
     `status='pending'` and set `nextAttemptAt = now + backoff(attempts)` with
     `lastError = err.message.slice(0, 500)`. Store the error, don't rethrow (a
     per-key failure must not abort the whole tick — mirror `TrashPurgeRunner`).
  - Backoff: `min(baseMs * 2 ** (attempts-1), maxMs) * jitter(0.5..1.5)`,
    e.g. `base 1s`, `cap 5min` — full-jitter to avoid thundering herd after an
    outage recovers.
- Resume-on-boot: no dedicated recovery pass is required — the outbox rows are
  committed, so the first tick after boot picks up all due `pending` intents.
  There is no persisted `inflight` status (single process + no-pileup guard), so
  a crash mid-send simply leaves the intent `pending` and it is retried. Document
  this as the "no lost intents" mechanism.
- Streaming detail: `openObjectStream` yields an fs/transform stream that needs no
  MikroORM context to read (noted in its docstring), so the S3 upload can outlive
  the per-tick context if needed; but keep the send inside `run()` and bound
  batch size so a tick can't run unboundedly long (the scheduler warns at 80% of
  interval). For objects `> largeObjectThresholdBytes` the target service uses
  `lib-storage` multipart ([TASK-2701]).
- Security / DoS considerations:
  - The worker sends **plaintext** object bytes (SSE decrypted) to the remote —
    this is why [TASK-2701] warns on `http://` endpoints; the object's own
    integrity was already verified at rest by the F1 read path.
  - Bounded per-tick work (`batchKeys`) + backoff prevent the drain from
    starving request handlers or hammering a degraded remote (defence-in-depth,
    consistent with EPIC-08 rate-limit posture).
  - Dead-letter cap prevents an un-replicable object (e.g. remote perms revoked)
    from being retried forever and pinning CPU/network.
  - A file descriptor per in-flight PUT — bounded by `batchKeys` — mirrors the
    backup service's "one fd at a time" discipline; ensure the source stream is
    destroyed on send failure.

## Acceptance criteria

- [ ] A `pending` PUT intent results in the object appearing in the remote bucket
      with matching bytes and `Content-Type`; the intent is removed after success.
- [ ] Two PUTs then a DELETE on the same key, enqueued before a drain, result in
      the remote key being **absent** and only one net remote operation observable
      (coalescing) — asserted in [TEST-0900].
- [ ] With the remote unreachable, intents stay `pending`, `attempts`/`nextAttemptAt`
      advance with backoff, and local reads/writes keep working; on remote
      recovery the backlog drains.
- [ ] After `maxAttempts` a permanently-failing intent becomes `status='failed'`
      and is no longer retried.
- [ ] Killing the process with `pending` intents and restarting drains them with
      no lost intent ([TEST-0900] crash-resume case).
- [ ] `nx test nestjs --testPathPattern=replication.runner` passes.

## Test obligations

- Unit: covered by [TEST-0900] (coalescing, backoff schedule, dead-letter)
- E2E: covered by [TEST-0900] (ordered drain + crash-resume against a container)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2700], [TASK-2701], [TASK-2702]
