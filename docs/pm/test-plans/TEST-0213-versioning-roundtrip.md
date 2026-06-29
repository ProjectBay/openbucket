---
id: TEST-0213
title: Versioning round-trip (PUT → PUT → DELETE → restore → list)
covers: [STORY-0213, TASK-0634, TASK-0635, TASK-0636, TASK-0637]
status: done
level: unit
---

## Goal
Exercise the full versioning lifecycle against the real on-disk layout and `:memory:` SQLite: versioned PUT chains preserve prior bytes under `<key>.v/`, delete-marker hides current, restore brings a prior version back, `listVersions` paginates newest-first per key, and the demote-on-write step is idempotent + `EXDEV`-resilient.

## Setup
- Real `:memory:` SQLite; initial migration applied.
- Real temporary `DATA_DIR`.
- Seed `Bucket { name: 'bv', versioning: VersioningState.Enabled }`.
- Instantiate `ObjectWriterService` (with demote step from TASK-0637), `BlobStore`, `VersionStoreService`.

## Cases
1. **Two-PUT chain:** `put({ bucket: 'bv', key: 'k', body: Readable.from('v1bytes') })` then `put({ bucket: 'bv', key: 'k', body: Readable.from('v2bytes') })`. After: `objects` has one row with `currentVersionId = <v2>`; `object_versions` has two rows ordered `(v1@earlier, v2@later)`; file at `blobs/bv/k` matches `'v2bytes'`; file at `blobs/bv/k.v/<v1>` matches `'v1bytes'`.
2. **Three-PUT chain** produces three `object_versions` rows and two files under `<key>.v/` (the two superseded versions).
3. **Delete marker:** call `VersionStoreService.writeDeleteMarker('bv', 'k')`. After: a new `object_versions` row with `isDeleteMarker = true, size = 0n`; no blob under `<key>.v/` for the marker version; `objects` row has `softDeleted = true, currentVersionId = <markerId>`; pointer file at `blobs/bv/k` is gone (in `trash/` with manifest).
4. **Restore via promoteToCurrent:** call `promoteToCurrent('bv', 'k', <v1>)`. After: file at `blobs/bv/k` matches `'v1bytes'`; `objects.currentVersionId === <v1>`; `objects.softDeleted === false`; `objects.etag === MD5('v1bytes').hex`.
5. **promoteToCurrent rejects delete-marker:** calling with a `versionId` whose row has `isDeleteMarker = true` throws `NotFoundException`.
6. **promoteToCurrent rejects unknown versionId:** throws `NotFoundException`.
7. **listVersions:** with versions `k1@v1, k1@v2, k2@v1` populated, `listVersions('bv', '', undefined, undefined, 100)` returns rows ordered `key ASC, createdAt DESC`.
8. **listVersions pagination:** `listVersions('bv', '', 'k1', undefined, 100)` returns only `k2@v1`.
9. **listVersions limit + 1 truncation fetch:** with 5 versions in scope and `limit = 3`, the method fetches 4 rows (assert via repo's query log).
10. **Demote idempotent:** manually pre-create `<key>.v/<v1>` with arbitrary bytes, then `put` over `k` so the writer would demote into the same path. The pre-existing file is preserved (link's `EEXIST` is treated as no-op).
11. **Demote `EXDEV` fallback:** mock `fs.link` to throw `EXDEV` once; verify `fs.copyFile` is called and the file lands at `<key>.v/<prevVersionId>`.
12. **Disabled bucket bypasses demote:** with `versioning: Disabled`, spy on `fs.link` and verify it is *not* called by the writer.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=version-store.service.spec.ts`

## Pass criteria
- [x] All twelve cases pass (`apps/openbucket-backend/src/storage/version-store.service.spec.ts`); backend suite 164/164 on re-run.

## References
- `docs/WHITEPAPER.md` §3.11 (lines 4957–5192)
