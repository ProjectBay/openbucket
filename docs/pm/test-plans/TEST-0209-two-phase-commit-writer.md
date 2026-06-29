---
id: TEST-0209
title: Two-phase commit happy path and rollback
covers: [STORY-0209, TASK-0627]
status: done
level: unit
---

## Goal
Verify `ObjectWriterService.put` follows the canonical sequence (transaction → stage+rename → row upsert → commit), and that a commit failure rolls back the row state and best-effort unlinks the renamed file.

## Setup
- Real `:memory:` SQLite via MikroORM; initial migration applied.
- Real temporary `DATA_DIR` for the on-disk path-mirror.
- Seed one `Bucket { name: 'b', versioning: Disabled }` and another `{ name: 'bv', versioning: Enabled }`.

## Cases
1. **Happy path, non-versioned:** `put({ bucket: 'b', key: 'k', body: Readable.from('hello') })`. After the call, `objects` has one row with `size = 5n`, `etag = MD5('hello').hex`, `storageClass = 'STANDARD'`, `softDeleted = false`; `object_versions` has zero rows; the file at `blobs/b/k` matches `'hello'`.
2. **Happy path, versioned:** `put({ bucket: 'bv', key: 'k', body: Readable.from('hi') })`. After the call, `objects` has one row with `currentVersionId` set; `object_versions` has one row with matching `versionId`, `isDeleteMarker = false`, size and etag matching.
3. **Update existing key:** call `put` twice on `(b, k)` with different bodies. After the second call, exactly one `objects` row exists for `(b, k)`; the file content matches the second PUT.
4. **Commit failure rollback:** inject a commit failure (e.g. drop the `objects` table mid-call, or use a mocked `em.commit` rejection). Verify `em.rollback()` is called, the `objects` row is not persisted, and `fs.unlink(finalPath)` is called best-effort.
5. **Unlink-fails-after-commit-error:** with `fs.unlink` also mocked to reject, verify the writer logs the warning `'failed to clean up post-rename file after commit error: ...'`.
6. **Pre-conditions for [TEST-0210]:** inject a crash *between* `putBlob` returning and `em.commit()` (simulate via a stub that throws before commit). After the test, a file exists at `blobs/b/k` and no row in `objects` — this is the "orphan blob" baseline reused by [TEST-0210].

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=object-writer.service.spec.ts`

## Pass criteria
- [x] All six cases pass (`apps/openbucket-backend/src/storage/object-writer.service.spec.ts`); backend suite 134/134.
- [x] No repository mocks — only `EntityManager.prototype.commit` and `fs.unlink` for crash injection.

## References
- `docs/WHITEPAPER.md` §3.7 (lines 4485–4644)
