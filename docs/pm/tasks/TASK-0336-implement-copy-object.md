---
id: TASK-0336
title: Implement CopyObject route
story: STORY-0109
status: done
type: implementation
size: S
---

## Description
Implement `PUT /:bucket/:key+` with `x-amz-copy-source` header (`CopyObject`) per §2.8.3.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PUT family, x-amz-copy-source branch)

## Implementation notes
- Route: `| PUT  | `/:bucket/:key+` | — (+ `x-amz-copy-source` header) | `CopyObject` | No body. |` (§2.8.3 line 2547).
- Per §2.1.1 (lines 1174–1176): `if (req.headers['x-amz-copy-source']) { return this.objects.copyObject(req, res, bucket, key); }`.
- Apply `@S3Operation('CopyObject')`.
- Returns POJO `{ __root: 'CopyObjectResult', ETag, LastModified }`.
- Honours `x-amz-metadata-directive: COPY|REPLACE` and `x-amz-copy-source-if-*` conditional headers.

## Acceptance criteria
- [ ] Response body is `<CopyObjectResult>` with `<ETag>` and `<LastModified>`.
- [ ] `x-amz-copy-source-if-match` mismatch → `PreconditionFailedError`.
- [ ] Source-not-found → `NoSuchKey`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2547), §2.1.1 (lines 1174–1176)
