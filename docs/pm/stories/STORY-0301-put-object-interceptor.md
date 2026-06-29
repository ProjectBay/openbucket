---
id: STORY-0301
title: PutObjectInterceptor with hash, size-cap, and MD5/SHA256 verification
epic: EPIC-04
status: done
size: M
risk: medium
---

## User story
As an S3 client, I want my PUT body to be hashed and verified inline as it streams, so that `Content-MD5` mismatches, `x-amz-content-sha256` mismatches, and oversized objects are rejected without buffering the whole body in memory.

## Description
Build `PutObjectInterceptor` at `apps/backend/src/s3/object/put-object.interceptor.ts`. The interceptor wires a `Transform` (`highWaterMark: 256 * 1024`) onto `req`, computes MD5 and SHA-256 inline, enforces `config.maxObjectSizeMb`, validates `Content-MD5` (base64) and `x-amz-content-sha256` (hex, with `UNSIGNED-PAYLOAD` opt-out and `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` rejected as `NotImplemented`), and exposes a `PutObjectStreamContext` (`stream`, `hashes`, `size`) at `req.openbucketPutCtx` for the handler to consume. Errors from `req` ('error', 'aborted') are forwarded into the verifier; errors from the verifier reject both promises. We never call `req.unpipe(verifier)` — `destroy()` detaches the pipe.

## Acceptance criteria
- [ ] Interceptor attaches `req.openbucketPutCtx = { stream, hashes, size }` after `intercept` is called.
- [ ] Body bytes greater than `maxObjectSizeMb * 1024 * 1024` cause the stream to emit `S3Error('EntityTooLarge', ...)`.
- [ ] A `Content-MD5` whose base64 disagrees with the computed MD5 causes `S3Error('BadDigest', ...)`.
- [ ] An `x-amz-content-sha256` whose hex disagrees with the computed SHA-256 causes `S3Error('XAmzContentSHA256Mismatch', ...)` (when not `UNSIGNED-PAYLOAD`).
- [ ] An `x-amz-content-sha256` of `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` returns `S3Error('NotImplemented', 'Chunked uploads are not supported in v1')`.
- [ ] A missing `x-amz-content-sha256` header returns `S3Error('InvalidRequest', 'x-amz-content-sha256 is required')`.
- [ ] On `req.on('aborted')`, `hashes` and `size` reject with `S3Error('RequestAborted', ...)`.
- [ ] `nx test backend --testPathPattern=put-object.interceptor.spec.ts` passes.

## Tasks
- [TASK-0902] Implement the PutObjectStreamContext shape and req augmentation declaration
- [TASK-0903] Implement header validation branch for `x-amz-content-sha256` and chunked rejection
- [TASK-0904] Implement the verifier Transform with hash, size cap, and digest verification in flush
- [TASK-0905] Wire request `error`/`aborted` handlers to reject the promises
- [TASK-0906] Register PutObjectInterceptor as a provider in the S3 module

## Test plan
- [TEST-0301] PutObjectInterceptor unit tests
- [TEST-0302] PUT/GET hot-path conformance with real S3 clients

## Dependencies
- Blocks: [STORY-0302], [STORY-0306]
- Blocked by: [STORY-0300]

## References
- `docs/WHITEPAPER.md` §4.1.2 (lines 5250–5402)
- Interfaces consumed: `ConfigService` (defined in [EPIC-01]), `S3Error` (defined in [EPIC-02])
- Interfaces produced: `PutObjectInterceptor`, `PutObjectStreamContext`, `req.openbucketPutCtx`
