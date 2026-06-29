---
id: TASK-0345
title: Implement AbortMultipartUpload route
story: STORY-0110
status: done
type: implementation
size: XS
---

## Description
Implement `DELETE /:bucket/:key+?uploadId=…` (`AbortMultipartUpload`) per §2.8.4.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (DELETE family uploadId branch)

## Implementation notes
- Route: `| DELETE | `/:bucket/:key+` | `uploadId=…` | `AbortMultipartUpload` | |` (§2.8.4 line 2573).
- Per §2.1.1 (lines 1224–1226): `if (q.uploadId !== undefined) { return this.multipart.abortUpload(req, res, bucket, key, q.uploadId); }`.
- Apply `@S3Operation('AbortMultipartUpload')`.
- Removes part blobs + upload row.

## Acceptance criteria
- [ ] Returns 204.
- [ ] Unknown `uploadId` → 404 `NoSuchUpload`.
- [ ] Part blobs and upload row removed.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0117]
- Conformance: covered by [TEST-0118]

## Dependencies
- Blocked by: [TASK-0301], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.4 (line 2573), §2.1.1 (lines 1224–1226)
