---
id: TASK-0343
title: Implement UploadPartCopy route
story: STORY-0110
status: done
type: implementation
size: S
---

## Description
Implement `PUT /:bucket/:key+?uploadId=…&partNumber=N` with `x-amz-copy-source` header (`UploadPartCopy`) per §2.8.4.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PUT family uploadId+partNumber+copy-source branch)

## Implementation notes
- Route: `| PUT  | `/:bucket/:key+` | `uploadId=…&partNumber=N` + `x-amz-copy-source` | `UploadPartCopy` | No body. |` (§2.8.4 line 2571).
- Per §2.1.1 (line 1166): `return this.multipart.uploadPartCopy(req, res, bucket, key, q);`.
- Apply `@S3Operation('UploadPartCopy')`.
- Honours `x-amz-copy-source-range` to copy a byte range from the source.
- Returns POJO `<CopyPartResult>` with `<ETag>` and `<LastModified>`.

## Acceptance criteria
- [ ] Returns `<CopyPartResult>`.
- [ ] Source-not-found → `NoSuchKey`.
- [ ] `x-amz-copy-source-range: bytes=A-B` honoured.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0117]
- Conformance: covered by [TEST-0118]

## Dependencies
- Blocked by: [TASK-0342], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.4 (line 2571), §2.1.1 (lines 1164–1167)
