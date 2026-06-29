---
id: TASK-0916
title: Implement UploadPartHandler with partNumber and session validation
story: STORY-0306
status: done
type: implementation
size: S
---

## Description
Create `apps/backend/src/s3/multipart/upload-part.handler.ts` with the `UploadPartHandler` controller. Inject `ConfigService` and `MultipartService`. The `@Put(':bucket/:key(*)')` handler validates `partNumber ∈ [1, 10_000]`, confirms the session via `multipart.get({ uploadId, bucket, key })`, and reads `req.openbucketPutCtx`.

## Files to create / modify
- `apps/backend/src/s3/multipart/upload-part.handler.ts` — new

## Implementation notes
- Verbatim per §4.4.2:
  ```ts
  const partNumber = Number(partNumberStr);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new S3Error('InvalidArgument', 'partNumber must be in [1, 10000]');
  }

  const session = await this.multipart.get({ uploadId, bucket, key });
  if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

  const ctx = req.openbucketPutCtx;
  if (!ctx) throw new S3Error('InternalError', 'PutObjectInterceptor did not run');
  ```
- Decorators: `@Put(':bucket/:key(*)')`, `@UseInterceptors(PutObjectInterceptor)`, `@HttpCode(200)`.

## Acceptance criteria
- [ ] partNumber outside `[1, 10000]` raises `S3Error('InvalidArgument', 'partNumber must be in [1, 10000]')`.
- [ ] Missing session raises `S3Error('NoSuchUpload', 'Upload <uploadId> not found')`.
- [ ] Missing `req.openbucketPutCtx` raises `S3Error('InternalError', 'PutObjectInterceptor did not run')`.

## Test obligations
- Unit: covered by [TEST-0311]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0906], [TASK-0914]

## References
- `docs/WHITEPAPER.md` §4.4.2 (lines 5795–5826)
