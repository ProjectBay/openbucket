---
id: TASK-0629
title: Implement `RecoveryService` multipart pass with directory delete
story: STORY-0210
status: done
type: implementation
size: S
---

## Description
Walk every top-level directory under `<DATA_DIR>/multipart/<uploadId>/`. For each `uploadId` with no matching row in `multipart_uploads`, remove the directory tree (`fs.rm(dirPath, { recursive: true, force: true })`) — those parts cannot be resumed because the upload state is gone — and record the path in `removedMultipartDirs`.

## Files to create / modify
- `apps/openbucket-backend/src/storage/recovery.service.ts` — modify (append multipart pass to `runScan`)

## Implementation notes
- Multipart-pass body (verbatim from §3.8):
  - Resolve `mpRoot` via `this.paths.multipartDir('').slice(0, -1);` (strip trailing separator) — do not poke private state on `PathResolver`.
  - If `mpRoot` exists, `await fs.readdir(mpRoot, { withFileTypes: true });`.
  - For each `isDirectory()` entry `d`: `const uploadId = d.name; const row = await this.em.findOne(MultipartUpload, { uploadId }, { fields: ['uploadId'] });`.
  - If `!row`: `const dirPath = join(mpRoot, uploadId); await fs.rm(dirPath, { recursive: true, force: true }); removedMultipartDirs.push(dirPath);`.
  - Increment `multipartScanned` per directory inspected.
- Per §3.8 second paragraph: "Directories without a row are deleted (they cannot be resumed — the upload state is gone)." Unlike blob orphans, stale multipart directories *are* safe to delete because each carries an isolated unique uploadId.

## Acceptance criteria
- [ ] A `multipart/<uuid>/1.part` directory whose `uploadId` is absent from `multipart_uploads` is fully removed by `runScan()` and its path appears in `removedMultipartDirs`.
- [ ] A `multipart/<uuid>/` directory whose `uploadId` *is* in `multipart_uploads` is left untouched.
- [ ] Missing `multipart/` directory does not throw.

## Test obligations
- Unit: covered by [TEST-0210]
- E2E: covered by [TEST-0210]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0607], [TASK-0628]

## References
- `docs/WHITEPAPER.md` §3.8 (lines 4737–4765)
