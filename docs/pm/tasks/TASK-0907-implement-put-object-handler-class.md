---
id: TASK-0907
title: Implement PutObjectHandler controller class
story: STORY-0302
status: done
type: implementation
size: S
---

## Description
Create `apps/backend/src/s3/object/put-object.handler.ts` with the `PutObjectHandler` controller. Inject `BlobStore` and `ObjectService`, declare `@Put(':bucket/:key(*)')` with `@HttpCode(200)`, and assemble the call flow: read `req.openbucketPutCtx`, invoke `blobs.putBlob({ bucket, key, source: ctx.stream, expectedLength })`, await `ctx.hashes` and `ctx.size`, call `objects.recordPut({ bucket, key, size, etag: md5Hex, sha256: sha256Hex, contentType, blobPath })`.

## Files to create / modify
- `apps/backend/src/s3/object/put-object.handler.ts` — new

## Implementation notes
- Constructor verbatim:
  ```ts
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}
  ```
- `expectedLength = contentLength ? Number(contentLength) : undefined`.
- `contentType` defaults to `'application/octet-stream'`.
- Throw `S3Error('InternalError', 'PutObjectInterceptor did not run')` when `ctx` is missing.

## Acceptance criteria
- [ ] Handler class compiles with the constructor signature above.
- [ ] Missing `req.openbucketPutCtx` produces `S3Error('InternalError', 'PutObjectInterceptor did not run')`.
- [ ] `recordPut` is called with the exact field shape from §4.1.3.

## Test obligations
- Unit: covered by [TEST-0303]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0906]

## References
- `docs/WHITEPAPER.md` §4.1.3 (lines 5405–5489)
