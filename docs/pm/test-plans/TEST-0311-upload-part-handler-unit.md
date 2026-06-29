---
id: TEST-0311
title: UploadPartHandler unit tests (incl. concurrent same-partNumber O_EXCL)
covers: [STORY-0306, TASK-0916, TASK-0917, TASK-0918]
status: backlog
level: unit
---

## Goal
Verify `UploadPartHandler` validates `partNumber`, refuses missing sessions, uses an `O_EXCL`-safe random-suffix tmp path, runs `pipeline()` to write the part, atomically renames on success, unlinks on failure, records the part, and sets the `ETag` header.

## Setup
- Real fs/promises against an OS temp `dataDir`.
- Mock `MultipartService.get` / `recordPart` as spies.
- Mock `IncomingMessage` with `openbucketPutCtx` whose `stream` is a `Readable.from([Buffer.alloc(128, 0)])`.

## Cases
1. Given `partNumber = 0` or `10001` or non-integer, then `S3Error('InvalidArgument', 'partNumber must be in [1, 10000]')`.
2. Given `MultipartService.get` returns `null`, then `S3Error('NoSuchUpload', 'Upload <uploadId> not found')`.
3. Given missing `openbucketPutCtx`, then `S3Error('InternalError', 'PutObjectInterceptor did not run')`.
4. Given a normal upload, then a file at `${partNumber}.part.${uuid}.tmp` is created (briefly), then renamed to `${partNumber}.part`, and `recordPart` is called with `{ uploadId, partNumber, size: 128, etag: <md5Hex> }`.
5. Given the verifier stream errors mid-write, then `unlink(tmpPath)` is called (best-effort) and the thrown error propagates.
6. Given two simultaneous `handle` invocations for the same `(uploadId, partNumber)`, neither throws `EEXIST` (verifies the `randomUUID()` suffix design), and the last `rename` wins.
7. Given the response, `ETag` header is `"<md5Hex>"` (quoted, lowercase hex).

## Tooling
- Framework: jest, fs/promises
- Runner: `nx test backend --testPathPattern=upload-part.handler.spec.ts`

## Pass criteria
- [ ] All seven cases pass.

## References
- `docs/WHITEPAPER.md` §4.4.2 (lines 5766–5862), §4.8 (lines 6183–6199)
