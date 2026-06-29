---
id: STORY-0305
title: InitiateMultipartUpload handler
epic: EPIC-04
status: done
size: S
risk: low
---

## User story
As an S3 client, I want `POST /<bucket>/<key>?uploads` to create a multipart upload session and return an `uploadId`, so that I can upload parts in parallel and later complete the assembly.

## Description
Implement `apps/backend/src/s3/multipart/initiate-multipart.handler.ts`. The handler generates an `uploadId` with `randomUUID()`, creates `<dataDir>/multipart/<uploadId>/` with `mkdir(..., { recursive: true, mode: 0o700 })`, persists the session via `MultipartService.initiate({ uploadId, bucket, key })`, and returns the structured value `{ bucket, key, uploadId }` (XML envelope is rendered by EPIC-02). Response status is `200`. Route binding (only fired when `?uploads` is present) is owned by EPIC-02.

## Acceptance criteria
- [ ] Handler creates `<dataDir>/multipart/<uploadId>` with mode `0o700`.
- [ ] Handler calls `MultipartService.initiate({ uploadId, bucket, key })`.
- [ ] Handler returns `{ bucket, key, uploadId }` and sets HTTP status 200.
- [ ] `uploadId` is a v4 UUID (validated via regex in tests).
- [ ] `nx test backend --testPathPattern=initiate-multipart.handler.spec.ts` passes.

## Tasks
- [TASK-0914] Implement InitiateMultipartHandler with mkdir + MultipartService.initiate
- [TASK-0915] Generate uploadId via randomUUID and return the DTO shape

## Test plan
- [TEST-0308] InitiateMultipartUpload unit tests
- [TEST-0309] Multipart lifecycle e2e via supertest
- [TEST-0310] Multipart conformance with real S3 clients

## Dependencies
- Blocks: [STORY-0306], [STORY-0307], [STORY-0308]
- Blocked by: _none_ (ConfigService from [EPIC-01], MultipartService from [EPIC-03])

## References
- `docs/WHITEPAPER.md` §4.4.1 (lines 5724–5763)
- Interfaces consumed: `ConfigService.dataDir` (defined in [EPIC-01]), `MultipartService.initiate` (defined in [EPIC-03])
- Interfaces produced: `InitiateMultipartHandler`
