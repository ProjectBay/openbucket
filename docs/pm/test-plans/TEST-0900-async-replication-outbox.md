---
id: TEST-0900
title: Async replication outbox — transactional enqueue, ordered drain, backoff, and crash-resume
covers: [STORY-0900, TASK-2700, TASK-2701, TASK-2702, TASK-2703, TASK-2704]
status: backlog
level: integration
---

## Goal

Prove the transactional-outbox guarantees of [STORY-0900]: intents are enqueued
in the write transaction (never orphaned), the worker applies them to a real
S3-compatible target in per-key order with last-writer coalescing, the system
survives remote outages via backoff + dead-letter, and a killed process resumes
the outbox on boot with no lost intents.

## Setup

- A MinIO container (S3-compatible; `forcePathStyle: true`) as the replication
  target, started via testcontainers; create the target bucket in `beforeAll`.
- Boot `@openbucket/nestjs` with `replication` configured to point at the
  container (`ReplicationConfig.enabled = true`, small `drainIntervalMs`, low
  `maxAttempts` for the dead-letter case).
- Use the injected `Clock` (`TestClock`) to fast-forward `nextAttemptAt` backoff
  windows deterministically.
- A helper to read the remote object via a second `@aws-sdk/client-s3` client and
  assert bytes/`Content-Type`.
- Config/unit cases run without the container ([TASK-2701] resolution,
  [TASK-2702] rollback, [TASK-2703] coalescing/backoff logic with a mocked target).

## Cases

1. **Transactional enqueue on PUT ([TASK-2702])** — PutObject a 1 KiB object;
   assert exactly one `replication_outbox` row (`op='PUT'`, `status='pending'`)
   with the object's `versionId`/`etag`/`size`, committed atomically with the
   `objects` row.
2. **Rollback drops the intent ([TASK-2702])** — force a write to fail before
   commit (exceed `STORAGE_QUOTA_BYTES` → `InsufficientStorageError`, or a digest
   mismatch); assert **zero** outbox rows exist (no orphan intent).
3. **Delete enqueues DELETE ([TASK-2702])** — for an unversioned bucket, a
   versioned bucket (delete-marker via `writeDeleteMarker`), and a lifecycle
   expiry (`moveToTrash`), assert a `pending` DELETE intent is committed in the
   same transaction.
4. **Ordered drain of a PUT ([TASK-2703])** — enqueue a PUT, run the drain tick;
   assert the object appears in MinIO byte-identical with the right
   `Content-Type`, and the intent row is removed after success.
5. **Coalescing last-writer-wins ([TASK-2703], [TASK-2704])** — enqueue
   `PUT(v1), PUT(v2), DELETE` on one key before draining; assert the remote key is
   **absent** afterward and earlier intents are marked `done`/removed (not
   individually applied). Repeat `PUT,PUT` → remote holds v2 only.
6. **SSE object replicates as plaintext ([TASK-2703])** — on an SSE-encrypted
   bucket, PUT then drain; assert the remote bytes equal the *plaintext*
   (decrypted via `openObjectStream`), not the on-disk ciphertext.
7. **Large-object multipart ([TASK-2701], [TASK-2704])** — PUT an object above
   `largeObjectThresholdBytes`; assert it streams to the remote via `lib-storage`
   and the remote size/etag are correct without buffering the whole object in RAM.
8. **Outage → backoff → recovery ([TASK-2703])** — stop the container, enqueue a
   PUT, run several ticks; assert the intent stays `pending`, `attempts` and
   `nextAttemptAt` advance per the backoff schedule, and local reads/writes keep
   succeeding. Restart the container, advance the clock, drain; assert the object
   lands.
9. **Dead-letter cap ([TASK-2703])** — with a perpetually-unreachable/permission-
   denied target and low `maxAttempts`, run ticks until `attempts >= maxAttempts`;
   assert the intent flips to `status='failed'` and is skipped by subsequent
   `dueKeys` queries.
10. **Crash-resume, no lost intents ([TASK-2703], [TASK-2704])** — enqueue several
    PUT/DELETE intents, tear down the Nest app *before* draining, boot a fresh app
    against the same `DATA_DIR`, run the drain; assert every intent is applied and
    the remote matches local current state.
11. **Disabled = no-op ([TASK-2701], [TASK-2702])** — boot with replication
    unset; assert no `S3Client` is constructed, PUT/DELETE write no outbox rows,
    and the drain task schedules nothing (existing storage specs unaffected).
12. **Config resolution & rejection ([TASK-2701])** — `{ enabled: false }` when
    unset; a partial standalone config (`ENABLED=true`, missing bucket/creds)
    refuses to boot; an `http://` endpoint logs a warning; secrets never appear in
    captured logs.

## Tooling

- Framework: jest + testcontainers (MinIO) + `@aws-sdk/client-s3`
- Runner: `nx test nestjs` (unit/logic cases) and `nx e2e nestjs-e2e` (container cases)

## Pass criteria

- [ ] All 12 cases pass.
- [ ] Case 2 shows zero orphan intents on rollback; Case 10 shows zero lost intents on crash-resume.
- [ ] Case 5 shows the remote reflects only the coalesced final state.
- [ ] Case 12 confirms no replication secret is present in captured log output.

## References

- `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.spec.ts` — batched-runner test pattern to mirror
- `libs/nestjs/src/lib/admin/backup/backup.service.spec.ts` — S3-ish streaming test setup
- `libs/nestjs/src/lib/storage/object-writer.service.ts` — the transaction the enqueue rides on
