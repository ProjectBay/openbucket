---
id: STORY-0303
title: GET object handler streaming from disk with fd cleanup
epic: EPIC-04
status: done
size: S
risk: medium
---

## User story
As an S3 client, I want `GET /<bucket>/<key>` to stream the stored bytes back with correct headers and a 200 (or 206 for ranges), so that I can retrieve any object and that file descriptors are released immediately if I disconnect mid-stream.

## Description
Implement `apps/backend/src/s3/object/get-object.handler.ts`. The handler looks up metadata via `ObjectService.head`, fetches the blob via `BlobStore.getBlob`, `stat`s the file to get the authoritative byte count, parses the `Range` header via `parseRange` (returning 416 for invalid/multi-range), sets `Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges`, `Content-Length` (and `Content-Range` for 206) **before** any body bytes, then `createReadStream(...{ highWaterMark: 256 * 1024 })` and pipes to `res`. On `res.once('close', ...)`, the read stream is `destroy()`ed to release the fd immediately. Stream errors after headers are sent destroy the socket.

## Acceptance criteria
- [ ] Missing object metadata returns `S3Error('NoSuchKey', ...)`.
- [ ] Missing blob file returns `S3Error('NoSuchKey', 'Blob missing for <bucket>/<key>')`.
- [ ] All response headers are set before `stream.pipe(res)`.
- [ ] `Content-Length` equals `stats.size` for non-range requests.
- [ ] On range requests, status is `206`, `Content-Range` is `bytes <start>-<end>/<size>`, `Content-Length` is `end - start + 1`.
- [ ] An invalid range yields HTTP 416 with `Content-Range: bytes */<size>`.
- [ ] On `res` 'close' before stream end, the read stream is destroyed (verified via spy).
- [ ] `nx test backend --testPathPattern=get-object.handler.spec.ts` passes.

## Tasks
- [TASK-0910] Implement GetObjectHandler with metadata + blob lookup
- [TASK-0911] Set headers in the exact order required before piping
- [TASK-0912] Wire client-disconnect cleanup (`res.once('close', destroy)`) and stream `error` handling

## Test plan
- [TEST-0305] GetObjectHandler unit tests
- [TEST-0306] GET object e2e via supertest (including 416)
- [TEST-0302] PUT/GET hot-path conformance with real S3 clients

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0302], [STORY-0304]

## References
- `docs/WHITEPAPER.md` §4.2 (lines 5523–5627)
- Interfaces consumed: `ObjectService.head` (defined in [EPIC-03]), `BlobStore.getBlob` (defined in [EPIC-03]), `parseRange` (defined in [STORY-0304])
- Interfaces produced: `GetObjectHandler`
