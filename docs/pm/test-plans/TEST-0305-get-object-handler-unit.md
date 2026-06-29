---
id: TEST-0305
title: GetObjectHandler unit tests
covers: [STORY-0303, TASK-0910, TASK-0911, TASK-0912]
status: done
level: unit
---

## Goal
Verify the GET handler looks up metadata + blob, sets all required headers before piping, parses single-range requests correctly, returns 416 on invalid range, and destroys the read stream on client disconnect.

## Setup
- Stub `BlobStore.getBlob` and `ObjectService.head`.
- Stub `fs.createReadStream` with a `PassThrough` spy to observe `destroy()`.
- Stub `fs/promises.stat` with a configurable `{ size, mtime }`.
- Stub Express `Response` and `Request` for header / status / close-event observation.

## Cases
1. Given missing meta, then handler throws `S3Error('NoSuchKey', '<bucket>/<key> not found')`.
2. Given missing blob, then handler throws `S3Error('NoSuchKey', 'Blob missing for <bucket>/<key>')`.
3. Given a normal GET, then `Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges`, `Content-Length` are set BEFORE `stream.pipe(res)` and status is 200.
4. Given `meta.versionId === 'abc'`, then `x-amz-version-id` is set to `'abc'`.
5. Given `Range: bytes=100-199` on a 1000-byte file, then status is 206, `Content-Range: bytes 100-199/1000`, `Content-Length: 100`, and `createReadStream` was called with `{ start: 100, end: 199, highWaterMark: 256 * 1024 }`.
6. Given `Range: bytes=999-2000` on a 1000-byte file (end clamped), then `Content-Range: bytes 999-999/1000`.
7. Given `Range: bytes=0-100,200-300`, then status is 416 and body is empty.
8. Given the response emits `'close'` before stream end, then the read stream is `destroy()`'d.
9. Given the read stream emits an error after headers sent, then `req.socket.destroy(err)` is called.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=get-object.handler.spec.ts`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §4.2 (lines 5523–5627)
