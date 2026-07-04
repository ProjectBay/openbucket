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
