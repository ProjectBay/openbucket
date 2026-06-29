---
id: TEST-0308
title: InitiateMultipartHandler unit tests
covers: [STORY-0305, TASK-0914, TASK-0915]
status: backlog
level: unit
---

## Goal
Verify `InitiateMultipartHandler` generates a v4 UUID, creates the staging directory with mode `0o700`, calls `MultipartService.initiate`, and returns the DTO.

## Setup
- Mock `ConfigService` with `dataDir = tmpDir()`.
- Mock `MultipartService.initiate` as a spy.

## Cases
1. Given a fresh request, when the handler runs, then `MultipartService.initiate` is called with `{ uploadId, bucket, key }` where `uploadId` matches the v4 UUID regex.
2. Given a successful run, then `<dataDir>/multipart/<uploadId>` exists with mode `0o700` (verified via `stat`).
3. Given a successful run, then the return value is exactly `{ bucket, key, uploadId }` and the response status is 200.
4. Given `mkdir` rejects, then the error propagates (no swallowing).

## Tooling
- Framework: jest, fs/promises against an OS temp dir
- Runner: `nx test backend --testPathPattern=initiate-multipart.handler.spec.ts`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §4.4.1 (lines 5724–5763)
