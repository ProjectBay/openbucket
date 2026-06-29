---
id: TASK-0635
title: Implement `VersionStoreService.writeDeleteMarker`
story: STORY-0213
status: done
type: implementation
size: S
---

## Description
Write a delete-marker `ObjectVersion` (no blob), move the current pointer file to trash, and set `softDeleted = true` and `currentVersionId = <markerId>` on the `ObjectEntity` — all within a single EM transaction.

## Files to create / modify
- `apps/openbucket-backend/src/storage/version-store.service.ts` — modify (add method)

## Implementation notes
- Signature (verbatim from §3.11.2): `async writeDeleteMarker(bucket: string, key: string): Promise<ObjectVersion>`.
- Body (verbatim sequence from §3.11.2):
  1. `const em = this.em.fork(); await em.begin();`
  2. `const row = await em.findOne(ObjectEntity, { bucket: { name: bucket }, key });`
  3. `if (!row) throw new NotFoundException('object not found');`
  4. Create marker: `const marker = em.create(ObjectVersion, { bucket: row.bucket, key, versionId: cryptoUuidV7(), size: 0n, etag: '', contentType: '', userMetadata: undefined, isDeleteMarker: true, createdAt: new Date() }); em.persist(marker);`
  5. `row.currentVersionId = marker.versionId; row.softDeleted = true; row.modifiedAt = new Date(); em.persist(row);`
  6. `await this.blobs.deleteBlob(bucket, key);` — move pointer file to trash.
  7. `await em.commit(); return marker;`.
  8. Catch: `await em.rollback().catch(() => undefined); throw err;`.
- `cryptoUuidV7()` defers to `node:crypto`'s `randomUUID()` (per §3.11.2 inline note "Defer to a small util in libs/common/uuid.ts in real code; inlined here so the snippet compiles standalone.") — wire to the shared util if one exists in [EPIC-01], otherwise inline.
- Per §3.11.4 table:
  - `Enabled` buckets: this method is the path.
  - `Suspended` buckets: caller passes a special version-id constant (`"null"`) — the service layer is responsible for that override and for the "overwrite any prior `null` marker" semantic.

## Acceptance criteria
- [ ] After `writeDeleteMarker(bucket, key)`, an `ObjectVersion` row with `isDeleteMarker = true` and `size = 0n` exists.
- [ ] The pointer file at `blobs/<bucket>/<encoded-key>` is gone (renamed into `trash/`).
- [ ] `ObjectEntity.softDeleted === true` and `ObjectEntity.currentVersionId === marker.versionId`.
- [ ] `writeDeleteMarker` on an unknown `(bucket, key)` throws `NotFoundException`.

## Test obligations
- Unit: covered by [TEST-0213]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0605], [TASK-0606], [TASK-0624], [TASK-0634]

## References
- `docs/WHITEPAPER.md` §3.11.2 (lines 5090–5142), §3.11.4 (lines 5180–5192)
