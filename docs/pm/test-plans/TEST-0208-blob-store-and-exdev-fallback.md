---
id: TEST-0208
title: BlobStore behaviour and EXDEV fallback
covers: [STORY-0208, TASK-0620, TASK-0621, TASK-0622, TASK-0623, TASK-0624, TASK-0625, TASK-0626]
status: done
level: unit
---

## Goal
Exercise every public method of `BlobStore` (and `PathResolver`) against a real temporary `DATA_DIR`, plus the `EXDEV` fallback via a one-shot `fs.rename` mock.

## Setup
- Per-test temporary `DATA_DIR` under `tmp/openbucket-blobstore-test/<uuid>/` (cleaned up between tests).
- Instantiate `BlobStore` with a `ConfigService` stub returning the temp path.
- Use real `fs` operations; only mock `fs.rename` for the `EXDEV` case.

## Cases
1. `PathResolver('/data').blobPath('mybucket', 'a key')` ends with `'mybucket/a%20key'`.
2. `PathResolver('/data').multipartPartPath('u1', 3)` ends with `'multipart/u1/3.part'`.
3. **putBlob happy path:** stream a known 10 MB buffer; the file at `finalPath` matches the source byte-for-byte; the returned `etag` matches `MD5(buf).hex` and `sha256` matches `SHA256(buf).hex`; `size` equals `BigInt(buf.length)`.
4. **putBlob error cleanup:** stream a `Readable` that errors mid-flight; no file exists at `tmpPath` or `finalPath` afterward.
5. **putBlob wx flag:** call `putBlob` twice in parallel with the same `randomUUID` mocked to a fixed value; one call fails with `EEXIST`.
6. **getBlob full:** after `putBlob` of `'abcdef'`, `getBlob` drained equals `'abcdef'`; `size === 6n`.
7. **getBlob range:** with the same fixture, `getBlob(b, k, { start: 1, end: 3 })` drained equals `'bcd'`.
8. **getBlob ENOENT:** missing key throws `ENOENT`-coded error.
9. **headBlob present:** returns `{ size, mtime }` matching `fs.stat`.
10. **headBlob missing:** returns `null` — no throw.
11. **deleteBlob:** after `deleteBlob`, the pointer file is gone; one file exists under `trash/`; the sibling `.manifest.json` parses to `{ entryId, bucket, key, originalPath, deletedAt }` matching the inputs.
12. **deleteBlob idempotent:** calling `deleteBlob` on a missing key returns without throwing.
13. **composeBlobs:** combine three known buffers; final file equals `Buffer.concat([b1, b2, b3])`; ETag matches MD5 of the concatenation; size matches sum of parts.
14. **composeBlobs error cleanup:** if part 2 throws on read, the tmp file is unlinked and `finalPath` does not exist.
15. **EXDEV fallback:** mock `fs.rename` once to throw `{ code: 'EXDEV' }`; verify `fs.copyFile` is called and the destination file ends up with the correct bytes, `src` is unlinked, and `log.warn` was called with substring `'EXDEV:'`.
16. **Non-EXDEV error rethrown:** mock `fs.rename` to throw `{ code: 'EACCES' }`; verify the call rejects and no fallback ran.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=blob-store.spec.ts`

## Pass criteria
- [x] All 16 cases pass (`apps/openbucket-backend/src/storage/blob-store.spec.ts`); backend suite 128/128; e2e green (10 passed / 4 POSIX-skipped).
- [x] Per-test temp `DATA_DIR` is removed in `afterEach`; the `compose-on-error` cleanup bug that caused Windows EPERM under the original spec is fixed by destroying the sink before unlinking (see STORY-0208 implementation note).

## Realization notes
- Case 5 (wx collision): asserts the node-level `flags: 'wx'` guarantee directly rather than mocking `crypto.randomUUID` (brittle on jest 30 + node 20 ESM imports).
- Case 9 (mtime): uses `getTime()` instead of `toBeInstanceOf(Date)` — jest's worker realm breaks cross-realm `instanceof` even for true Date values.

## References
- `docs/WHITEPAPER.md` §3.6 (lines 4128–4482), §3.9 (lines 4804–4825)
