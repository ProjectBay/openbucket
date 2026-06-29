---
id: TASK-0620
title: Implement `PathResolver`
story: STORY-0208
status: done
type: implementation
size: XS
---

## Description
Implement the `PathResolver` helper that maps logical bucket / key / uploadId arguments to absolute on-disk paths under `DATA_DIR`. Every filesystem path in the storage layer is derived from this class.

## Files to create / modify
- `apps/openbucket-backend/src/storage/paths.ts` — new

## Implementation notes
- `class PathResolver { constructor(private readonly dataDir: string) {} ... }`.
- Methods (verbatim signatures from §3.6.1):
  - `blobsDir(): string` → `join(this.dataDir, 'blobs')`
  - `bucketDir(bucket: string): string` → `join(this.blobsDir(), bucket)`
  - `blobPath(bucket: string, key: string): string` → `join(this.bucketDir(bucket), encodeKey(key))`
  - `versionDir(bucket: string, key: string): string` → `this.blobPath(bucket, key) + '.v'`
  - `versionPath(bucket: string, key: string, versionId: string): string` → `join(this.versionDir(bucket, key), versionId)`
  - `multipartDir(uploadId: string): string` → `join(this.dataDir, 'multipart', uploadId)`
  - `multipartPartPath(uploadId: string, partNumber: number): string` → `join(this.multipartDir(uploadId), \`${partNumber}.part\`)`
  - `tmpDir(): string` → `join(this.dataDir, 'tmp')`
  - `tmpPath(name: string): string` → `join(this.tmpDir(), name)`
  - `trashDir(): string` → `join(this.dataDir, 'trash')`
- Import `encodeKey` from `./key-codec`. Use `join` from `node:path`.

## Acceptance criteria
- [ ] `new PathResolver('/data').blobPath('mybucket', 'my key.txt')` ends with `'mybucket/my%20file.txt'` (or equivalent encoded form).
- [ ] `versionDir(bucket, key)` returns `blobPath(bucket, key) + '.v'`.
- [ ] `multipartPartPath('abc', 3)` ends with `'multipart/abc/3.part'`.

## Test obligations
- Unit: covered by [TEST-0208]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0618]

## References
- `docs/WHITEPAPER.md` §3.6.1 (lines 4140–4182)
