---
id: TASK-2702
title: Write replication intents transactionally on PUT/DELETE
story: STORY-0900
status: backlog
type: implementation
size: M
---

## Description

Add the enqueue seam that inserts a `replication_outbox` row **inside the same
MikroORM transaction** as every object-metadata commit, so an intent is durably
tied to the write that produced it (never lost, never orphaned by a rollback).
This is the transactional-outbox guarantee at the heart of [STORY-0900]. When
replication is disabled the seam returns immediately.

## Files to create / modify

- `libs/nestjs/src/lib/storage/replication/replication-outbox.service.ts` — new (`enqueue(em, intent)` seam)
- `libs/nestjs/src/lib/storage/replication/replication.module.ts` — modify (provide/export the service)
- `libs/nestjs/src/lib/storage/object-writer.service.ts` — modify (enqueue PUT intent before `em.commit()` in `putLocked` + `putComposedLocked`)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (enqueue DELETE intent in `deleteOne` unversioned tx and in `moveToTrash`)
- `libs/nestjs/src/lib/storage/version-store.service.ts` — modify (enqueue DELETE intent in `writeDeleteMarker` tx)
- `libs/nestjs/src/lib/storage/storage.module.ts` / `domain/domain.module.ts` — modify (wire the optional dependency)

## Implementation notes

- `ReplicationOutboxService.enqueue` joins the **caller's** `EntityManager`
  (the open transaction), it does NOT fork:
  ```ts
  enqueue(em: EntityManager, intent: {
    bucket: Bucket; key: string; op: 'PUT' | 'DELETE';
    versionId?: string; etag?: string; size?: bigint; contentType?: string;
  }): void {
    if (!this.config.enabled) return;               // zero-cost when disabled
    em.persist(em.create(ReplicationOutbox, {
      id: randomUUID(), bucket: intent.bucket, key: intent.key, op: intent.op,
      versionId: intent.versionId, etag: intent.etag, size: intent.size,
      contentType: intent.contentType, status: 'pending', attempts: 0,
      nextAttemptAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    }));                                            // committed by the caller's em.commit()
  }
  ```
- Wire-in points (all already run inside a transaction — the row rides along on
  the existing `em.commit()`, so the intent commits **iff** the write commits):
  - `ObjectWriterService.putLocked`: after `em.persist(row)` and before
    `await em.commit()` — `this.outbox?.enqueue(em, { bucket, key, op: 'PUT',
    versionId: row.currentVersionId, etag: row.etag, size: row.size,
    contentType: row.contentType })`. Same in `putComposedLocked`.
  - `ObjectService.deleteOne` (unversioned branch): after `em.persist(row)` /
    before `await em.commit()` — enqueue `op: 'DELETE'`.
  - `ObjectService.moveToTrash` (lifecycle expiry, joins the runner's tx) —
    enqueue `op: 'DELETE'` on the passed `em`.
  - `VersionStoreService.writeDeleteMarker` — enqueue `op: 'DELETE'` (a versioned
    delete hides the current version; one-way replication reflects the *visible*
    state, i.e. delete the remote key). Document that per-version history is NOT
    replicated in v1 (only the current visible object), matching the EPIC-10
    "one-way local→remote" scope.
- Inject the service as `@Optional()` everywhere (like
  `ObjectWriterService`'s `@Optional() config?`), so the storage unit tests that
  construct the writer without it, and a disabled deployment, both keep working.
- Idempotency handoff: the worker coalesces multiple intents per key
  ([TASK-2703]), so this seam does NOT need to dedupe — always append. `versionId`
  + `seq` let the worker drop superseded intents. A PUT that overwrites the same
  key twice therefore enqueues two rows; the worker sends only the latest.
- Edge cases:
  - Copy (`ObjectService.copyObject`) and admin upload (`putFromStream`) both flow
    through `ObjectWriterService.put`, so they are covered automatically.
  - Multipart complete flows through `putComposed` — covered.
  - A rolled-back write (quota reject `InsufficientStorageError`, digest
    mismatch, object-lock `AccessDenied`) rolls back the intent too — assert this
    in [TEST-0900] (no orphan intent).
  - Because enqueue is in-transaction and synchronous (no I/O), it adds no
    latency to the hot write path beyond one INSERT, and none at all when disabled.
- Security: no new external surface — the write has already been authorized by the
  `PolicyAuthorizationGuard` (`s3/authz/policy-evaluator`) before reaching the
  writer, so replication cannot be triggered by an unauthorized request. Keys are
  stored verbatim (as elsewhere); no traversal sink here (the DB is the sink).

## Acceptance criteria

- [ ] A committed `PutObject` produces exactly one `pending` PUT intent with the
      row's `versionId`/`etag`/`size`; a `putComposed` does the same.
- [ ] A committed delete (unversioned, versioned delete-marker, lifecycle expiry)
      produces a `pending` DELETE intent.
- [ ] A write that throws before commit (quota/digest/object-lock) leaves **zero**
      outbox rows (transactional rollback) — asserted in [TEST-0900].
- [ ] With replication disabled, no outbox row is written and the writer/delete
      hot paths are unchanged (existing storage specs still pass).

## Test obligations

- Unit: covered by [TEST-0900] (enqueue-in-tx + rollback-drops-intent cases)
- E2E: covered by [TEST-0900] (PUT then observe remote object)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2700], [TASK-2701]
