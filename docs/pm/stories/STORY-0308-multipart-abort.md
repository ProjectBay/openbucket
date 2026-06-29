---
id: STORY-0308
title: AbortMultipartUpload handler
epic: EPIC-04
status: done
size: XS
risk: low
---

## User story
As an S3 client, I want `DELETE /<bucket>/<key>?uploadId=` to abandon a multipart upload, so that the staging area and rows are cleaned up and the session no longer accepts parts.

## Description
Implement `apps/backend/src/s3/multipart/abort-multipart.handler.ts`. The handler validates the session via `MultipartService.get`, then deletes rows-first via `MultipartService.abort({ uploadId })` and finally `rm(<dataDir>/multipart/<uploadId>, { recursive: true, force: true })`. The "rows first, then filesystem" order is deliberate: if we crash between the two, the multipart-cleanup tick (§4.9) picks up the now-orphaned directory by mtime. Response status is 204 with no body.

## Acceptance criteria
- [ ] Missing session raises `S3Error('NoSuchUpload', 'Upload <uploadId> not found')`.
- [ ] `MultipartService.abort` is called before the directory `rm`.
- [ ] Directory removal uses `recursive: true, force: true`.
- [ ] HTTP status code is `204` on success.
- [ ] `nx test backend --testPathPattern=abort-multipart.handler.spec.ts` passes.

## Tasks
- [TASK-0923] Implement AbortMultipartHandler with session lookup + rows-first ordering
- [TASK-0924] Wire fs/promises.rm and 204 response

## Test plan
- [TEST-0313] AbortMultipartUpload unit tests
- [TEST-0309] Multipart lifecycle e2e via supertest
- [TEST-0310] Multipart conformance with real S3 clients

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0305]

## References
- `docs/WHITEPAPER.md` §4.4.4 (lines 5994–6032)
- Interfaces consumed: `MultipartService.get/abort` (defined in [EPIC-03]), `ConfigService.dataDir` (defined in [EPIC-01])
- Interfaces produced: `AbortMultipartHandler`
