---
id: TASK-0344
title: Implement CompleteMultipartUpload route
story: STORY-0110
status: done
type: implementation
size: M
---

## Description
Implement `POST /:bucket/:key+?uploadId=…` (`CompleteMultipartUpload`) per §2.8.4.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (POST family q.uploadId branch)

## Implementation notes
- Route: `| POST | `/:bucket/:key+` | `uploadId=…` | `CompleteMultipartUpload` | XML body `<CompleteMultipartUpload>`. |` (§2.8.4 line 2572).
- Per §2.1.1 (line 1212): `if (q.uploadId) return this.multipart.completeUpload(req, res, bucket, key, q.uploadId);`.
- Apply `@S3Operation('CompleteMultipartUpload')`. The op is in `XML_REQUEST_OPS` (§2.3.2 line 1383).
- Body schema: `<CompleteMultipartUpload><Part><PartNumber>N</PartNumber><ETag>…</ETag></Part>…</CompleteMultipartUpload>` (Part hinted as array by parser).
- Validates parts:
  - Ascending `PartNumber` order → else `InvalidPartOrderError`.
  - Each part exists with matching ETag → else `InvalidPartError(PartNumber)`.
  - Each non-last part ≥ 5 MiB → else `EntityTooSmallError`.
- Composes the final ETag as `MD5(concat(MD5(part_i)))-N` per the glossary.
- Returns POJO `{ __root: 'CompleteMultipartUploadResult', Location, Bucket, Key, ETag }`.

## Acceptance criteria
- [ ] Out-of-order parts → 400 `InvalidPartOrder`.
- [ ] Missing or mismatched part ETag → 400 `InvalidPart` with `<PartNumber>`.
- [ ] Final ETag matches `MD5(concat(MD5(part_i)))-N` format.
- [ ] Returns `<CompleteMultipartUploadResult>`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0117]
- Conformance: covered by [TEST-0118]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0102], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.4 (line 2572), §2.1.1 (line 1212), §2.3.2 (line 1383)
