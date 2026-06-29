---
id: TASK-0341
title: Implement CreateMultipartUpload route
story: STORY-0110
status: done
type: implementation
size: S
---

## Description
Implement `POST /:bucket/:key+?uploads` (`CreateMultipartUpload`) per §2.8.4.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (POST family `'uploads' in q` branch)

## Implementation notes
- Route: `| POST | `/:bucket/:key+` | `uploads` | `CreateMultipartUpload` | Returns `<InitiateMultipartUploadResult>` with `UploadId`. |` (§2.8.4 line 2569).
- Per §2.1.1 (line 1211): `if ('uploads' in q) return this.multipart.createUpload(req, res, bucket, key);`.
- Apply `@S3Operation('CreateMultipartUpload')`.
- Returns POJO `{ __root: 'InitiateMultipartUploadResult', Bucket, Key, UploadId }`.

## Acceptance criteria
- [ ] Response is `<InitiateMultipartUploadResult>` with a generated `UploadId`.
- [ ] `Content-Type`, `Cache-Control`, `Content-Disposition`, `x-amz-meta-*` headers from the request are stashed for the eventual completed object.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0117]
- Conformance: covered by [TEST-0118]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.4 (line 2569), §2.1.1 (line 1211)
