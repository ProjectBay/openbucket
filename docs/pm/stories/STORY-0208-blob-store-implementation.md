---
id: STORY-0208
title: BlobStore — atomic stage-and-rename filesystem layer
epic: EPIC-03
status: done
size: L
risk: high
---

## User story
As a developer, I want the `BlobStore` service with `putBlob`/`getBlob`/`headBlob`/`deleteBlob`/`composeBlobs` plus the `PathResolver` helper and `EXDEV` fallback, so that every domain service can persist, read, and delete object bodies on disk with atomic-rename semantics and inline MD5/SHA-256 hashing.

## Description
Build the path resolver, then the `BlobStore` exactly per §3.6: `putBlob` stages writes in `tmp/`, hashes inline, `fsync`s, then `rename(2)`s into place; `getBlob` opens a `fs.createReadStream` with optional `{ start, end }`; `headBlob` returns `null` on `ENOENT`; `deleteBlob` moves the file into `trash/<uuid>` plus a sibling `<uuid>.manifest.json`; `composeBlobs` concatenates parts into a staged file with per-chunk hashing, then atomically renames. The `atomicRename` internal traps `EXDEV` and falls back to copy + unlink with a warning log. Stream lifecycles (abort, backpressure) are explicitly *not* owned here — they belong to EPIC-04. This Story owns the signatures consumed there.

## Acceptance criteria
- [x] `PathResolver` exposes the 10 documented helpers per §3.6.1.
- [x] `BlobStore.putBlob` uses `wx`, hashes MD5+SHA-256 inline, `fsync`s, atomic-renames; returns `{ size, etag, sha256, finalPath }` with `size: bigint`.
- [x] `BlobStore.getBlob(bucket, key, range?)` returns `{ stream: ReadStream, size: bigint }`.
- [x] `BlobStore.headBlob` returns `null` on `ENOENT`.
- [x] `BlobStore.deleteBlob` is idempotent under `ENOENT` and writes `<uuid>.manifest.json` with `entryId/bucket/key/originalPath/deletedAt`.
- [x] `BlobStore.composeBlobs` concatenates parts into one tmp file, hashes the combined stream, atomically renames.
- [x] `atomicRename` traps `EXDEV`, falls back to `copyFile` + `unlink`, logs `log.warn(...)`.
- [x] Mocked-`fs.rename` test verifies the EXDEV fallback runs (TEST-0208 case 15) and the file lands at the destination; a non-EXDEV `EACCES` rethrows without fallback (case 16).

## Tasks
- [TASK-0620] Implement `PathResolver`
- [TASK-0621] Implement `BlobStore.putBlob` (stage + hash + fsync + rename)
- [TASK-0622] Implement `BlobStore.getBlob` (range-aware read stream)
- [TASK-0623] Implement `BlobStore.headBlob` (stat-only, ENOENT → null)
- [TASK-0624] Implement `BlobStore.deleteBlob` (move-to-trash + manifest)
- [TASK-0625] Implement `BlobStore.composeBlobs` (multi-part concatenation)
- [TASK-0626] Implement `atomicRename` with EXDEV copy+unlink fallback

## Test plan
- [TEST-0208] BlobStore behaviour and EXDEV fallback

## Implementation notes
- `composeBlobs` catch path closes the sink (`destroy()` + wait for `close`)
  before unlinking the tmp file — on Windows an open writable handle makes the
  file undeletable, leading to a tmp-file leak and a cascading `EPERM` during
  test cleanup. The single-stream `putBlob` doesn't need this because
  `pipeline()` already handles teardown.
- The `wx`-collision case (test #5) asserts the node-level guarantee directly
  (`createWriteStream(path, { flags: 'wx' })` twice → second raises `EEXIST`)
  rather than mocking `crypto.randomUUID` (brittle on jest 30 + node 20 ESM).
- `mtime` assertion uses `getTime()` instead of `instanceof Date` because
  jest's worker realm intermittently breaks `instanceof` for cross-realm
  values even when the type is correct.
- `StorageModule` now provides + exports `BlobStore` so future consumers
  (STORY-0209 ObjectWriterService, STORY-0210 orphan-blob scan) can inject it.

## Dependencies
- Blocks: [STORY-0209], [STORY-0210], [STORY-0213], [EPIC-04]
- Blocked by: [STORY-0207], [STORY-0205]

## References
- `docs/WHITEPAPER.md` §3.6 (lines 4128–4482)
- Interfaces produced (consumed by [EPIC-04] streaming and [STORY-0209] / [STORY-0213]):
  - `putBlob(bucket: string, key: string, source: Readable | string): Promise<PutResult>`
  - `getBlob(bucket: string, key: string, range?: RangeSpec): Promise<{ stream: ReadStream; size: bigint }>`
  - `headBlob(bucket: string, key: string): Promise<HeadResult | null>`
  - `deleteBlob(bucket: string, key: string): Promise<void>`
  - `composeBlobs(parts: BlobRef[], destBucket: string, destKey: string): Promise<PutResult>`
