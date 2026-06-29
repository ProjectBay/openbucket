---
id: TEST-0301
title: PutObjectInterceptor unit tests
covers: [STORY-0301, TASK-0902, TASK-0903, TASK-0904, TASK-0905, TASK-0906]
status: done
level: unit
---

## Goal
Verify the streaming interceptor produces a verified body stream, settles the hash/size promises, enforces the size cap, validates Content-MD5 and x-amz-content-sha256, and rejects on client abort — all without buffering the body.

## Setup
- Jest fake timers off (real promises).
- Mock `ConfigService` with `maxObjectSizeMb = 1` (so 1 MiB cap is easy to exceed in tests).
- A helper that builds a stub `IncomingMessage` from a `Readable` and a headers bag, then runs the interceptor under a stub `ExecutionContext`.

## Cases
1. Given a body of 256 bytes and matching Content-MD5 + correct x-amz-content-sha256, when the stream ends, then `ctx.hashes` resolves to the computed `{ md5Hex, md5Base64, sha256Hex }` and `ctx.size` resolves to 256.
2. Given a body that exceeds `maxObjectSizeMb * 1024 * 1024`, when the stream is consumed, then the verifier emits `S3Error('EntityTooLarge', 'Object exceeds 1048576 bytes')`.
3. Given a Content-MD5 base64 that disagrees with the body MD5, when the stream ends, then the verifier emits `S3Error('BadDigest', 'Content-MD5 mismatch')`.
4. Given an `x-amz-content-sha256` hex that disagrees with the body SHA-256 (and is not `UNSIGNED-PAYLOAD`), then the verifier emits `S3Error('XAmzContentSHA256Mismatch', 'x-amz-content-sha256 mismatch')`.
5. Given `x-amz-content-sha256 === 'UNSIGNED-PAYLOAD'`, then the SHA-256 check is skipped (resolves regardless).
6. Given `x-amz-content-sha256 === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD'`, then the interceptor immediately throws `S3Error('NotImplemented', 'Chunked uploads are not supported in v1')`.
7. Given a missing `x-amz-content-sha256` header, then `S3Error('InvalidRequest', 'x-amz-content-sha256 is required')`.
8. Given the request emits `'aborted'` mid-stream, then `ctx.hashes` and `ctx.size` both reject with `S3Error('RequestAborted', 'Client aborted the request')` and the verifier is destroyed.
9. Given the request emits `'error'` with an arbitrary `Error`, then both promises reject with that error.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=put-object.interceptor.spec.ts`

## Pass criteria
- [ ] All nine cases pass.
- [ ] No test calls `req.on('data', ...)` directly (verified by an ESLint rule or grep guard).

## References
- `docs/WHITEPAPER.md` §4.1.2 (lines 5250–5402), §4.7 (lines 6140–6172)
