---
id: TEST-0303
title: PutObjectHandler unit tests
covers: [STORY-0302, TASK-0907, TASK-0908, TASK-0909]
status: done
level: unit
---

## Goal
Verify the PUT handler wires `BlobStore.putBlob` + `ObjectService.recordPut`, propagates / wraps errors, and sets the `ETag` and (when present) `x-amz-version-id` response headers.

## Setup
- Mock `BlobStore.putBlob` and `ObjectService.recordPut`.
- Mock `IncomingMessage` with a populated `openbucketPutCtx`.
- Mock Express `Response` with spies on `setHeader`.

## Cases
1. Given a normal PUT, when the handler runs, then `putBlob` is called with `{ bucket, key, source: ctx.stream, expectedLength }` and `recordPut` with `{ bucket, key, size, etag: md5Hex, sha256: sha256Hex, contentType, blobPath }`.
2. Given missing `openbucketPutCtx`, when the handler runs, then it throws `S3Error('InternalError', 'PutObjectInterceptor did not run')`.
3. Given `putBlob` throws a non-`S3Error`, then the handler rethrows `S3Error('InternalError', <msg>, { cause })`.
4. Given `putBlob` throws an `S3Error`, then the handler rethrows it unchanged.
5. Given `recordPut` returns `{ versionId: 'abc' }`, then `res.setHeader('x-amz-version-id', 'abc')` is called.
6. Given `recordPut` returns `{ versionId: undefined }`, then `setHeader` for `x-amz-version-id` is NOT called.
7. The `ETag` header is set to `"<md5Hex>"` (quoted, lowercase hex).

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=put-object.handler.spec.ts`

## Pass criteria
- [ ] All seven cases pass.

## References
- `docs/WHITEPAPER.md` §4.1.3 (lines 5403–5489)
