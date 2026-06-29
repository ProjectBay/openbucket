---
id: TEST-0313
title: AbortMultipartUpload unit tests
covers: [STORY-0308, TASK-0923, TASK-0924]
status: backlog
level: unit
---

## Goal
Verify `AbortMultipartHandler` rejects unknown uploadIds, deletes rows before fs, removes the staging directory, and returns 204.

## Setup
- Real fs/promises against an OS temp `dataDir` with a staging dir for a fake uploadId.
- Mock `MultipartService.{ get, abort }`.

## Cases
1. Given `multipart.get` returns `null`, then `S3Error('NoSuchUpload', 'Upload <uploadId> not found')` is thrown.
2. Given a valid session, then `multipart.abort({ uploadId })` is called BEFORE `rm`.
3. After the handler, the staging directory `<dataDir>/multipart/<uploadId>` no longer exists.
4. `rm` is called with `{ recursive: true, force: true }`.
5. Response HTTP status is 204 (verified via `@HttpCode(204)` metadata or supertest assertion).

## Tooling
- Framework: jest, fs/promises
- Runner: `nx test backend --testPathPattern=abort-multipart.handler.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §4.4.4 (lines 5994–6032)
