---
id: STORY-0900
title: Async replication to an external S3-compatible target
epic: EPIC-10
status: backlog
size: XL
risk: high
---

## User story

As an **operator** of a single-node OpenBucket, I want every object PUT and
DELETE to be asynchronously replicated to an external S3-compatible target (AWS
S3, Cloudflare R2, Backblaze B2, or another OpenBucket), so that my data survives
a local disk failure without giving up the single-process, local-first design.

## Description

Introduces a **transactional outbox**: a durable `replication_outbox` row is
written in the *same* MikroORM transaction as the object-metadata commit
(`ObjectWriterService.put`/`putComposed` and the delete seams), so an intent is
never lost or written for a write that rolled back. A background `ScheduledTask`
(the existing §4.9 tick) drains the outbox with per-key ordering, last-writer
coalescing, exponential backoff, and a dead-letter cap, streaming object bytes to
the remote via `@aws-sdk/client-s3`. Because intents are committed to SQLite they
**resume on boot** with no lost work, and the drain survives remote outages by
retrying. Replication is opt-in via config; when unconfigured the enqueue seam is
a zero-cost no-op and nothing changes.

## Acceptance criteria

- [ ] With a target configured, a successful `PutObject` commits exactly one
      `replication_outbox` PUT intent in the same transaction as the object row;
      a rolled-back write commits **no** intent.
- [ ] A successful delete (unversioned soft-delete, versioned delete-marker, and
      lifecycle expiry) commits a DELETE intent in the same transaction.
- [ ] The background drain applies pending intents to the remote bucket in
      per-key sequence order; the remote object's bytes and `Content-Type` match
      the local current version.
- [ ] Killing the process with pending intents and restarting resumes the drain —
      no intent is lost and the remote converges (verified in [TEST-0900]).
- [ ] While the remote is unreachable the local store keeps serving reads/writes;
      intents retry with exponential backoff and `attempts`/`lastError` are
      recorded; past `maxAttempts` an intent is dead-lettered (`status='failed'`),
      not retried forever.
- [ ] Superseded intents for a key (an older PUT/DELETE behind a newer one) are
      coalesced so the remote reflects the current local state, not every
      historical write.
- [ ] Replication is fully disabled by default: with no target configured the
      enqueue seam short-circuits, no `S3Client` is constructed, and the drain
      task schedules nothing.
- [ ] Replication credentials never appear in logs (redacted like the existing
      SigV4/JWT secrets); the target endpoint is validated and a plaintext-`http`
      target is warned about at boot.

## Tasks

- [TASK-2700] Add the replication_outbox entity, migration, and repository
- [TASK-2701] Add replication config/options and the S3-compatible target client
- [TASK-2702] Write replication intents transactionally on PUT/DELETE
- [TASK-2703] Drain the outbox in a background worker with ordering, backoff, and dead-letter
- [TASK-2704] Spike: validate ordering, coalescing, large-object upload, and crash-resume against a real target

## Test plan

- [TEST-0900] Async replication outbox — transactional enqueue, ordered drain, backoff, and crash-resume

## Dependencies

- Blocks: [STORY-0902] (replication status & reconciliation reads the outbox)
- Blocked by: —
- Reuses EPIC-08 security posture: the PUT/DELETE that enqueues an intent has
  already passed `s3/authz/policy-evaluator` via the `PolicyAuthorizationGuard`,
  so replication adds no new ingress; log redaction follows the
  `open-bucket-core.module.ts` pino `redact` pattern; blob reads go through the
  existing safe `BlobStore`/`key-codec` paths (no new traversal surface).

## Spike findings (TASK-2704)

Conclusions adopted by the implementation tasks (the throwaway `__spike__`
scripts were removed at close; the cases were promoted into the unit specs):

- **Ordering / `seq` mechanism** — a dedicated `seq` column, assigned at enqueue
  from a process-monotonic generator (`nextReplicationSeq`: `Date.now()*1000`,
  `+1` on same-ms collision, non-decreasing across restarts), rather than SQLite
  `rowid`. `seq` only needs a total order consistent with insert order; the
  `ObjectWriterService` per-`(bucket,key)` mutex already serializes same-key
  writes, so same-key intents are enqueued (and ordered) in write order.
  `ReplicationOutboxRepository.dueKeys` orders due keys by `min(seq)` and
  `pendingForKey` returns a key's chain `seq ASC`.
- **Coalescing** — act on the LAST intent of a key's chain, mark every earlier
  one `done`. This converges the remote to the local current visible state for
  every chain (`PUT,PUT` → one PUT; `PUT,DELETE` → one DELETE; `DELETE,PUT` →
  one PUT; `PUT,DELETE,PUT` → one PUT). Matches EPIC-10's one-way
  local→remote, current-visible-state scope — per-version history is NOT
  replicated in v1 (a versioned delete-marker replicates as a remote DELETE).
- **Large objects** — the object size is always known (from the object row), so
  a plain `PutObjectCommand` with `ContentLength` is used below the threshold and
  `@aws-sdk/lib-storage` `Upload` (streaming multipart) above it. Threshold:
  `largeObjectThresholdBytes = 64 MiB` (`OB_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES`).
- **Crash-resume / idempotency** — no persisted `inflight` state is needed
  (single process + the scheduler's no-pileup guard). A crash mid-send leaves the
  intent `pending`; the first tick after boot re-sends it. PUT is idempotent by
  key, DELETE is idempotent (a remote 404 is success), so a re-send is safe.
- **Retry realism** — full-jitter exponential backoff `min(1s * 2^(n-1), 5min)
  * rand(0.5..1.5)`; dead-letter to `status='failed'` after
  `maxAttempts = 12` (`OB_REPLICATION_MAX_ATTEMPTS`). The SDK's own retry is
  disabled (`maxAttempts: 1`) so the worker owns the single retry budget.
- **Security** — an `http://` endpoint logs a boot-time warning (replicated
  bytes are object plaintext); `OB_REPLICATION_SECRET_ACCESS_KEY` /
  `secretAccessKey` / `authorization` are in the pino redact paths.

## References

- `libs/nestjs/src/lib/storage/object-writer.service.ts` — `ObjectWriterService.put` / `putComposed` (the metadata-commit transaction)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `deleteOne`, `moveToTrash`, `openObjectStream` (decrypting read used to source replica bytes)
- `libs/nestjs/src/lib/storage/version-store.service.ts` — `writeDeleteMarker`
- `libs/nestjs/src/lib/common/background/background.service.ts` — `ScheduledTask`, `SCHEDULED_TASKS`, no-pileup tick + per-tick `RequestContext`
- `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts` — batched-drain-with-cursor pattern to mirror
- `libs/nestjs/src/lib/persistence.module.ts` — entity + `migrationsList` registration
- `libs/nestjs/src/lib/persistence/entities/lifecycle-state.entity.ts` — small-entity + resume-cursor pattern
- `libs/nestjs/src/lib/admin/backup/backup.service.ts` — existing S3-ish streaming/archival patterns
- `libs/nestjs/src/lib/open-bucket-options.ts` + `common/config/env.schema.ts` — dual config surface (library options vs standalone env)
- New dependency: `@aws-sdk/client-s3` (and optionally `@aws-sdk/lib-storage` for large-object multipart uploads)
