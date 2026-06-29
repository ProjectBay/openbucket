---
id: TASK-0342
title: Implement UploadPart route
story: STORY-0110
status: done
type: implementation
size: S
---

## Description
Implement `PUT /:bucket/:key+?uploadId=…&partNumber=N` (`UploadPart`) per §2.8.4.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PUT family uploadId+partNumber branch)

## Implementation notes
- Route: `| PUT  | `/:bucket/:key+` | `uploadId=…&partNumber=N` | `UploadPart` | Body is the part. |` (§2.8.4 line 2570).
- Per §2.1.1 (lines 1164–1169):
  ```ts
  if (q.uploadId !== undefined && q.partNumber !== undefined) {
    if (req.headers['x-amz-copy-source'] !== undefined) {
      return this.multipart.uploadPartCopy(req, res, bucket, key, q);
    }
    return this.multipart.uploadPart(req, res, bucket, key, q);
  }
  ```
- Apply `@S3Operation('UploadPart')`.
- Response header `ETag` = MD5 of part bytes (EPIC-04 streams + computes).

## Acceptance criteria
- [ ] `partNumber` 1..10000 accepted.
- [ ] Unknown `uploadId` → `NoSuchUploadError`.
- [ ] `ETag` header returned.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0117]
- Conformance: covered by [TEST-0118]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0103], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.4 (line 2570), §2.1.1 (lines 1164–1169)
