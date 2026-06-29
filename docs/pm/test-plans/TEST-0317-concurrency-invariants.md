---
id: TEST-0317
title: Concurrency invariants integration tests
covers: [STORY-0312, TASK-0932, TASK-0933, TASK-0934]
status: done
level: unit
---

## Goal
Verify the same-partNumber O_EXCL collision tolerance and the PUT-same-key last-rename-wins semantics with real fs + SQLite.

## Setup
- Test Nest app with `:memory:` SQLite and a temp `dataDir`.
- Pre-create bucket; pre-Initiate an upload for the part-collision test.

## Cases
1. **Same-partNumber concurrent UploadParts**: fire two `PUT ...?uploadId=X&partNumber=1` requests with distinct 5 MiB payloads simultaneously. Assert: both return HTTP 200; neither errors with `EEXIST`; the on-disk `1.part` size matches the second writer; the `multipart_parts` row's ETag equals the second writer's MD5.
2. **PUT-same-key concurrent**: fire two `PUT /<bucket>/<key>` requests with distinct payloads simultaneously. Both return 200 with their respective ETags. A subsequent GET returns the second writer's bytes and `ETag` equals the second writer's MD5.
3. CONCURRENCY.md exists with the full §4.8 table (grep assertion).

## Tooling
- Framework: jest, supertest, fs/promises
- Runner: `nx test backend --testPathPattern=concurrency.spec.ts`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §4.8 (lines 6175–6204)
