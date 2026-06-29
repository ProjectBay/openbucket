---
id: STORY-0306
title: UploadPart handler with O_EXCL staging and per-part ETag
epic: EPIC-04
status: done
size: M
risk: medium
---

## User story
As an S3 client, I want `PUT /<bucket>/<key>?uploadId=&partNumber=` to stream a part to disk, validate it like a single-shot PUT, and return the part's MD5 as its ETag, so that I can later present the part list to `CompleteMultipartUpload`.

## Description
Implement `apps/backend/src/s3/multipart/upload-part.handler.ts`. The handler validates `partNumber ∈ [1, 10_000]`, confirms the session exists via `MultipartService.get`, reads `req.openbucketPutCtx` from `PutObjectInterceptor`, opens `createWriteStream(tmpPath, { flags: 'wx', highWaterMark: 256 * 1024, mode: 0o600 })`, uses `pipeline(ctx.stream, writable)` (which propagates backpressure and errors), unlinks `tmpPath` on error, then `rename(tmpPath, finalPath)` for last-rename-wins atomic publish. Per §4.8 a `randomUUID()` suffix on `tmpPath` is used so concurrent same-partNumber uploads do not collide on `O_EXCL`. After rename, calls `MultipartService.recordPart({ uploadId, partNumber, size, etag: md5Hex })` and sets `ETag: "<md5Hex>"`.

## Acceptance criteria
- [ ] `partNumber` outside `[1, 10000]` raises `S3Error('InvalidArgument', 'partNumber must be in [1, 10000]')`.
- [ ] Missing session raises `S3Error('NoSuchUpload', ...)`.
- [ ] Tmp path uses pattern `${partNumber}.part.${randomUUID()}.tmp` to avoid O_EXCL collisions.
- [ ] Writable opens with `flags: 'wx'`, `highWaterMark: 256 * 1024`, `mode: 0o600`.
- [ ] Pipeline errors cause `unlink(tmpPath)` (best-effort).
- [ ] On success, `rename(tmpPath, finalPath)` runs before `recordPart`.
- [ ] `MultipartService.recordPart` is called with `{ uploadId, partNumber, size, etag: md5Hex }`.
- [ ] Response header `ETag` equals `"<md5Hex>"`.
- [ ] `nx test backend --testPathPattern=upload-part.handler.spec.ts` passes.

## Tasks
- [TASK-0916] Implement UploadPartHandler controller with partNumber + session validation
- [TASK-0917] Implement O_EXCL-safe tmp path with randomUUID suffix and pipeline write
- [TASK-0918] Wire `MultipartService.recordPart` and ETag header

## Test plan
- [TEST-0311] UploadPartHandler unit tests (incl. concurrent same-partNumber O_EXCL path)
- [TEST-0309] Multipart lifecycle e2e via supertest
- [TEST-0310] Multipart conformance with real S3 clients

## Dependencies
- Blocks: [STORY-0307]
- Blocked by: [STORY-0301], [STORY-0305]

## References
- `docs/WHITEPAPER.md` §4.4.2 (lines 5766–5863)
- `docs/WHITEPAPER.md` §4.8 (lines 6175–6204) — same-partNumber collision pattern
- Interfaces consumed: `ConfigService.dataDir` (defined in [EPIC-01]), `MultipartService.get/recordPart` (defined in [EPIC-03]), `PutObjectInterceptor` (defined in [STORY-0301])
- Interfaces produced: `UploadPartHandler`
