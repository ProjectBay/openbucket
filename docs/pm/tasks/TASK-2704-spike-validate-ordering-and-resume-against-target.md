---
id: TASK-2704
title: "Spike: validate ordering, coalescing, large-object upload, and crash-resume against a real target"
story: STORY-0900
status: backlog
type: spike
size: S
---

## Description

De-risk the four hardest correctness questions in [STORY-0900] before the
implementation tasks lock in their approach: (1) the exact `seq`/ordering
mechanism, (2) coalescing semantics vs. AWS one-way replication expectations,
(3) large-object streaming to R2/B2/MinIO via `lib-storage`, and (4) crash-resume
with no lost or duplicated intents. Produces a short findings note and the chosen
constants that [TASK-2700]/[TASK-2703] adopt.

## Files to create / modify

- `libs/nestjs/src/lib/storage/replication/__spike__/` — new (throwaway scripts, deleted at close)
- `docs/pm/stories/STORY-0900-async-replication-to-external-s3-target.md` — modify (fold conclusions into References/notes if they change the design)

## Implementation notes

- **Ordering mechanism**: confirm whether a dedicated `seq` autoincrement column
  or SQLite `rowid` ASC gives a stable total order under the WAL + `synchronous=FULL`
  config in `persistence.module.ts`. Verify `ReplicationOutboxRepository.dueKeys`
  produces per-key `seq` order under concurrent writers (the `ObjectWriterService`
  per-key mutex already serializes same-key writes, so intents for one key are
  inserted in write order — validate this holds across `fork()`ed EMs).
- **Coalescing correctness**: enumerate the intent chains that occur in practice —
  `PUT,PUT`, `PUT,DELETE`, `DELETE,PUT`, `PUT,DELETE,PUT` — and confirm
  "act on last, mark earlier `done`" converges the remote to the local current
  state for each. Confirm this matches EPIC-10's "one-way local→remote, current
  visible state" scope (no per-version replication in v1).
- **Large objects**: measure `@aws-sdk/lib-storage` `Upload` streaming a >64 MiB
  and a multi-GB object into MinIO and Cloudflare R2; pick
  `largeObjectThresholdBytes`, part size, and queue size. Confirm a plain
  `PutObjectCommand` with `ContentLength` works when the size is known (it always
  is — from the object row) to avoid multipart overhead on small objects.
- **Crash-resume / idempotency**: kill the process mid-drain (before the `done`
  update commits) and confirm the intent is re-sent on boot and the remote object
  is byte-identical (PUT is naturally idempotent by key; DELETE is idempotent).
  Confirm no persisted `inflight` state is needed given single-process +
  no-pileup guard.
- **Retry realism**: point the target at an unreachable host and a
  perms-revoked bucket; confirm backoff advances and the dead-letter cap trips —
  feeds the `maxAttempts`/backoff constants.
- Security/DoS check: confirm `http://` endpoint warning fires and that secrets do
  not appear in the SDK debug logs / pino output at the configured `LOG_LEVEL`.

## Acceptance criteria

- [ ] A findings note lists the chosen `seq` mechanism, coalescing rules,
      `largeObjectThresholdBytes`/part size, and backoff constants.
- [ ] A reproducible crash-resume demonstration (script + notes) shows no lost or
      corrupted remote object.
- [ ] The spike scripts are removed (or promoted into [TEST-0900]); no throwaway
      code remains in the tree at close.

## Test obligations

- Unit: N/A — spike
- E2E: findings are promoted into [TEST-0900] cases
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2700], [TASK-2701]
