---
id: STORY-0312
title: Concurrency invariants doc and O_EXCL collision tolerance
epic: EPIC-04
status: done
size: S
risk: medium
---

## User story
As a developer, I want the concurrency invariants table from §4.8 captured as a living document and the same-partNumber `O_EXCL` collision tolerance verified by an integration test, so that future changes do not silently regress the "last-rename-wins" semantics.

## Description
Materialize the §4.8 invariants table as `apps/backend/src/s3/CONCURRENCY.md` (the table verbatim) and write an integration test that triggers two concurrent same-`partNumber` UploadParts against the same `uploadId`. The test relies on the `randomUUID()` tmp-suffix pattern introduced in [STORY-0306] so the second writer does not fail `O_EXCL`. The test must show both writes succeed, the second `rename(2)` atomically wins, and the `multipart_parts` row reflects the later record (per AWS semantics).

## Acceptance criteria
- [ ] `apps/backend/src/s3/CONCURRENCY.md` exists and contains the eight-row §4.8 table.
- [ ] Concurrent same-`partNumber` test does not throw `EEXIST`.
- [ ] After both writes settle, the `<N>.part` file size matches the second writer's payload (last-rename-wins).
- [ ] `multipart_parts.etag` for `(uploadId, N)` equals the MD5 of the second writer's payload.
- [ ] Concurrent PUT-same-key test shows both blobs streamed, second SQLite commit wins.
- [ ] `nx test backend --testPathPattern=concurrency.spec.ts` passes.

## Tasks
- [TASK-0932] Author CONCURRENCY.md with the §4.8 invariants table verbatim
- [TASK-0933] Write same-partNumber O_EXCL tolerance integration test
- [TASK-0934] Write PUT-same-key last-rename-wins integration test

## Test plan
- [TEST-0317] Concurrency invariants integration tests

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0302], [STORY-0306]

## References
- `docs/WHITEPAPER.md` §4.8 (lines 6175–6204)
- Interfaces consumed: `PutObjectHandler` (defined in [STORY-0302]), `UploadPartHandler` (defined in [STORY-0306])
