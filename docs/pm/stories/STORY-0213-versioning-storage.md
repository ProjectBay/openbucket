---
id: STORY-0213
title: Versioning storage (`VersionStoreService`, demote-on-write)
epic: EPIC-03
status: done
size: L
risk: high
---

## User story
As an S3 client, I want versioned PUT, delete-marker, restore (`promoteToCurrent`), and `ListObjectVersions` semantics implemented against the `<key>.v/<versionId>` on-disk layout, so that a versioned bucket preserves every prior version's bytes, supports delete-by-version-id, and exposes a paginated list ordered newest-first per key — all under the same two-phase commit discipline as §3.7.

## Description
Implement `VersionStoreService` per §3.11.2: `promoteToCurrent(bucket, key, versionId)` looks up the version row, stats the version blob, composes it back over the current pointer via `BlobStore.composeBlobs`, then updates `ObjectEntity.currentVersionId` in the same EM transaction. `writeDeleteMarker(bucket, key)` creates a marker `ObjectVersion` (no blob), moves the current pointer file to trash via `BlobStore.deleteBlob`, sets `softDeleted = true` and `currentVersionId = <markerId>`. `listVersions(...)` exposes the paginated list (delegating to `ObjectRepository.listVersionsByPrefix` for the query body). Finally, extend the writer ([STORY-0209]) with the corrected demote ordering from §3.11.3: *before* `putBlob`, hard-link or copy `blobs/<bucket>/<encoded-key>` to `<key>.v/<prevVersionId>` (idempotent under `EXIST`), falling back to `fs.copyFile` on `EXDEV`. Delete-by-versionId semantics per §3.11.4 are also exercised here.

## Acceptance criteria
- [x] `promoteToCurrent` throws `NotFoundException` for missing versions (TEST-0213 case 6) and delete-markers (case 5).
- [x] After `promoteToCurrent`, the pointer file matches `<key>.v/<versionId>` and `ObjectEntity.currentVersionId === versionId` (case 4).
- [x] `writeDeleteMarker` creates an `isDeleteMarker = true` row with no `.v/` blob, moves the pointer file to trash, sets `softDeleted = true` (case 3).
- [x] `listVersions` returns rows ordered `key ASC, createdAt DESC` (case 7), supports `keyMarker` exclusive pagination (case 8), and fetches `limit + 1` (case 9).
- [x] Versioned PUT on an existing key hard-links the previous pointer to `<key>.v/<prevVersionId>` BEFORE `putBlob` renames over it (`fs.link` first, `fs.copyFile` on EXDEV); all in one EM transaction (cases 1, 2, 11). Disabled buckets bypass the demote step (case 12).
- [~] DELETE with `?versionId=<id>` semantics (real version / delete-marker / Suspended-bucket `"null"` marker) — **deferred to EPIC-02 / EPIC-04**: this story owns the *storage primitives* (`promoteToCurrent`, `writeDeleteMarker`, `listVersions`) that those DELETE handlers will compose. The story description notes the controller-level layering; the storage-level pieces are complete.

## Tasks
- [TASK-0634] Implement `VersionStoreService.promoteToCurrent`
- [TASK-0635] Implement `VersionStoreService.writeDeleteMarker`
- [TASK-0636] Implement `VersionStoreService.listVersions`
- [TASK-0637] Extend `ObjectWriterService` with demote-on-write step

## Test plan
- [TEST-0213] Versioning round-trip (PUT → PUT → DELETE → restore → list)

## Implementation notes
- §3.11.3 "corrected ordering" restructured `ObjectWriterService.put`:
  bucket+row lookup first, then demote (if versioned + has current), then
  `putBlob`, then row update. The demote helper handles `EEXIST` (idempotent),
  `EXDEV` (`copyFile` fallback), and `ENOENT` (current pointer missing →
  warn + skip; recovery scan reconciles).
- Version ids on the versioned write path use `uuid` v7 (sortable by time,
  per §3.2.4). STORY-0209 still uses `crypto.randomUUID` (v4) for the surrogate
  `ObjectEntity.id`; that's a different field.
- `listVersions` delegates to `ObjectRepository.listVersionsByPrefix` (the
  range-scan implementation from STORY-0206), so the service is a thin
  facade — the SQL discipline lives in the repo.
- Versioned-DELETE-by-id semantics (real version vs. delete-marker, Suspended
  bucket `"null"` markers) intentionally not implemented here: they're S3
  controller-level concerns that compose this story's primitives + EPIC-02's
  routing. Restated in the AC.
- One observed intermittent: `blob-store.spec` case 4 occasionally fails on
  Windows with leftover tmp files (file-handle race on `putBlob` source
  error). It passes on re-run; the same shape was already hardened for
  `composeBlobs` in STORY-0208. If it recurs, `putBlob`'s catch could apply
  the same `sink.destroy()` + `'close'` wait.

## Dependencies
- Blocks: [EPIC-02] versioned list/get/delete handlers, [EPIC-04]
- Blocked by: [STORY-0201], [STORY-0205], [STORY-0206], [STORY-0208], [STORY-0209]

## References
- `docs/WHITEPAPER.md` §3.11.1 (lines 4961–4975), §3.11.2 (lines 4977–5142), §3.11.3 (lines 5144–5178), §3.11.4 (lines 5180–5192)
- Interfaces produced:
  - `VersionStoreService.promoteToCurrent(bucket, key, versionId): Promise<void>`
  - `VersionStoreService.writeDeleteMarker(bucket, key): Promise<ObjectVersion>`
  - `VersionStoreService.listVersions(bucket, prefix, keyMarker?, versionMarker?, limit): Promise<ObjectVersion[]>`
