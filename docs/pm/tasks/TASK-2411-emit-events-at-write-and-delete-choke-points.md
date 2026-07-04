---
id: TASK-2411
title: Emit events at the write and delete commit choke points
story: STORY-0801
status: backlog
type: implementation
size: M
---

## Description
Wire `ObjectEventsService` into the storage/domain layer so every stored or removed object emits exactly one typed event, at the transaction-commit boundary, covering both the S3 and admin/library paths through a minimal set of choke points. `object.created` and `multipart.completed` emit from `ObjectWriterService` (the single write funnel for `PutObject`, `CopyObject`, admin `putFromStream`, and `CompleteMultipartUpload`); `object.deleted` emits from `ObjectService.deleteOne` (the shared seam for `DeleteObject`, bulk `DeleteObjects`, and admin delete). Emission is post-commit and error-isolated so it never changes write semantics.

## Files to create / modify
- `libs/nestjs/src/lib/storage/object-writer.service.ts` — modify: inject `@Optional() ObjectEventsService`; after the successful `em.commit()` in `putLocked` (line 219) emit `object.created`; after commit in `putComposedLocked` (line 344) emit `multipart.completed`.
- `libs/nestjs/src/lib/storage/storage.module.ts` — modify: no import needed if `EventsModule` is `@Global` (TASK-2410), but confirm `ObjectEventsService` resolves; keep the writer constructable in unit tests via `@Optional()`.
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify: inject `ObjectEventsService`; in `deleteOne` (line 614) emit `object.deleted` after each committing branch (the versioned delete-marker branch line 625 and the unversioned `em.commit()` branch line 649), only when a row was actually removed/hidden.
- `libs/nestjs/src/lib/domain/objects/object.service.spec.ts` / `storage/object-writer.service.spec.ts` — modify: assert emit is called once per committed write with the right payload, and NOT called on a rolled-back write.

## Implementation notes
- **Post-commit, in-process** emit uses the payload built from the returned row — all fields are already in hand:
  ```ts
  // putLocked, right after `await em.commit()` (line 219), before `return row`:
  this.events?.emitInProcess({
    type: OBJECT_EVENTS.created,
    bucket: cmd.bucket,
    key: cmd.key,
    size: Number(put.size),
    etag: put.etag,
    versionId: row.currentVersionId,
    eventTime: row.modifiedAt.toISOString(),
  });
  ```
  In `putComposedLocked` use `OBJECT_EVENTS.multipartCompleted`, `Number(composed.size)`, `cmd.etag` (the md5-of-md5s), and `row.currentVersionId`.
- **Delete emit** in `deleteOne`:
  - Versioned branch (line 625): after `writeDeleteMarker` returns, emit `object.deleted` with `size: 0`, `etag: ''`, `versionId: marker.versionId`, `eventTime: new Date().toISOString()`.
  - Unversioned branch: emit only when a `row` existed and `em.commit()` succeeded (i.e. inside the `try` after commit at line 649, not on the early `return {}` at line 639 for an absent key), with `size: 0`, `etag: ''`, no `versionId`.
  - Do NOT emit when the key was absent/already-deleted — the operation is idempotent and semantically a no-op, so a spurious `object.deleted` would mislead handlers.
- **Ordering vs. the outbox**: the durable webhook enqueue ([TASK-2412]) must be *in the same transaction* as the write, so it happens BEFORE commit inside the writer; the in-process `emitInProcess` here happens AFTER commit. Keep these two concerns separate: this task only adds the post-commit in-process emit; [TASK-2412] adds the pre-commit `enqueueInTx(em, event)` call adjacent to `em.persist(row)`.
- **Error isolation / no regression**: `emitInProcess` is fire-and-forget (TASK-2410) and `@Optional()`, so a missing provider (storage unit tests) or a throwing handler cannot break `put`/`delete`. Emit must sit AFTER commit so a rolled-back write (F2/F3 restore path, lines 223–246) emits nothing — assert this explicitly.
- **Concurrency**: `put`/`putComposed` already run under the per-key mutex (`withKeyLock`, line 110) and `deleteOne` under its own EM transaction, so events for the same key are naturally serialized in commit order; document that cross-key ordering is not guaranteed (consumers use `eventTime`).
- **Security**: no new authz surface — the request already passed `policy-authorization.guard`/`policy-evaluator` (EPIC-08) before reaching these methods, and admin writes passed `JwtAuthGuard`. The payload contains only already-authorized, already-bounded fields (key length is capped by `storage/key-codec.ts`); no request headers or credentials are included.

## Acceptance criteria
- [ ] A committed `PutObject` (S3), `putFromStream` (admin), and `copyObject` each emit exactly one `object.created` with correct `size`/`etag`/`versionId`.
- [ ] `CompleteMultipartUpload` emits exactly one `multipart.completed` carrying the `-N` multipart ETag.
- [ ] `DeleteObject`/bulk/admin delete emit `object.deleted`; an idempotent delete of an absent key emits nothing.
- [ ] A write whose commit throws (forced in a spec) emits no event and restores per F2/F3.
- [ ] `nx test nestjs --testPathPattern="object-writer|object.service"` passes with the new assertions.

## Test obligations
- Unit: covered by [TEST-0801] (cases 4–7).
- E2E: covered by [TEST-0801] (case 12 — real S3 PUT/DELETE through the wire triggers a registered handler).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2410] (`ObjectEventsService`, `OBJECT_EVENTS`, payload type).

## References
- `libs/nestjs/src/lib/storage/object-writer.service.ts:105,219,255,344` (commit boundaries).
- `libs/nestjs/src/lib/domain/objects/object.service.ts:614,625,649` (`deleteOne` branches).
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts:182` (`completeUpload` → `writer.putComposed`).
- `libs/nestjs/src/lib/storage/key-codec.ts` (key bounds, EPIC-08).
</content>
