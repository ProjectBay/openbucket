---
id: STORY-0302
title: PUT object handler streaming to BlobStore
epic: EPIC-04
status: done
size: S
risk: medium
---

## User story
As an S3 client, I want `PUT /<bucket>/<key>` to stream my body straight to disk and return an ETag, so that a multi-GB upload completes with bounded memory and the persisted bytes match my upstream MD5.

## Description
Implement `apps/backend/src/s3/object/put-object.handler.ts`. The handler reads `req.openbucketPutCtx` set by `PutObjectInterceptor`, calls `BlobStore.putBlob({ bucket, key, source: ctx.stream, expectedLength })`, awaits `ctx.hashes` and `ctx.size`, then calls `ObjectService.recordPut(...)` and sets `ETag: "<md5Hex>"` and (when versioning is enabled) `x-amz-version-id`. Errors that are not `S3Error` are wrapped in `S3Error('InternalError', ...)`; `BlobStore` guarantees tmp cleanup on stream error. Route binding (`@Put(':bucket/:key(*)')`) is declared here but the dispatch into this controller is owned by EPIC-02.

## Acceptance criteria
- [ ] Handler throws `S3Error('InternalError', 'PutObjectInterceptor did not run')` if `req.openbucketPutCtx` is missing.
- [ ] Handler calls `BlobStore.putBlob` with `{ bucket, key, source: ctx.stream, expectedLength }` (where `expectedLength = Number(contentLength)` when present).
- [ ] After `putBlob` resolves, handler awaits `ctx.hashes` and `ctx.size` before calling `ObjectService.recordPut`.
- [ ] `recordPut` is invoked with `{ bucket, key, size, etag: md5Hex, sha256: sha256Hex, contentType, blobPath }` (defaulting `contentType` to `'application/octet-stream'`).
- [ ] Response header `ETag` equals `"<md5Hex>"` (quoted, lowercase hex).
- [ ] When `recordPut` returns a `versionId`, header `x-amz-version-id` is set.
- [ ] Non-`S3Error` exceptions are wrapped in `S3Error('InternalError', ...)` preserving `cause`.
- [ ] `nx test backend --testPathPattern=put-object.handler.spec.ts` passes.

## Tasks
- [TASK-0907] Implement PutObjectHandler controller class with BlobStore + ObjectService injection
- [TASK-0908] Wire `@UseInterceptors(PutObjectInterceptor)` and `@RawReq()` parameter
- [TASK-0909] Translate BlobStore errors into S3Error and set ETag/x-amz-version-id headers

## Test plan
- [TEST-0303] PutObjectHandler unit tests
- [TEST-0304] PUT object e2e via supertest
- [TEST-0302] PUT/GET hot-path conformance with real S3 clients

## Dependencies
- Blocks: [STORY-0303], [STORY-0307]
- Blocked by: [STORY-0301]

## References
- `docs/WHITEPAPER.md` §4.1.3 (lines 5403–5519)
- Interfaces consumed: `BlobStore.putBlob` (defined in [EPIC-03]), `ObjectService.recordPut` (defined in [EPIC-03]), `S3Error` (defined in [EPIC-02])
- Interfaces produced: `PutObjectHandler`
