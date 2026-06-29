---
id: STORY-0311
title: Backpressure invariants and explicit highWaterMark settings
epic: EPIC-04
status: done
size: S
risk: medium
---

## User story
As a developer, I want the streaming hot path's backpressure to be enforced by explicit highWaterMark values and verified by tests, so that 100 concurrent multi-GB PUTs use ~1 MiB of in-flight buffer per request rather than buffering bodies in memory.

## Description
Verify and document the three explicit highWaterMark settings: `PutObjectInterceptor`'s Transform (`256 * 1024`), `GetObjectHandler`'s `createReadStream` (`256 * 1024`), and `UploadPartHandler`'s `createWriteStream` (`256 * 1024`). Codify the "never" list as ESLint-banned patterns (best-effort) and as a developer doc comment in `apps/backend/src/s3/object/README.md`: never `req.on('data')`, never accumulate `Buffer[]` then concat, never `await` non-chunk-bound work inside `_transform`. Provide a memory probe test that PUTs a 1 GiB body and asserts process RSS stays below 256 MiB. The 1 MiB per-PUT ceiling is `(TCP recv buf) + 256 KB (verifier) + 256 KB (writable)`.

## Acceptance criteria
- [ ] All three highWaterMark sites use `256 * 1024` (asserted via grep in the test).
- [ ] A README at `apps/backend/src/s3/object/README.md` lists the three "never" rules with §4.7 references.
- [ ] A 1 GiB PUT memory probe test keeps RSS under 256 MiB on the test runner.
- [ ] `nx test backend --testPathPattern=backpressure.spec.ts` passes.

## Tasks
- [TASK-0929] Audit and pin highWaterMark constants in interceptor, GET handler, and UploadPart handler
- [TASK-0930] Add backpressure README under apps/backend/src/s3/object/
- [TASK-0931] Write 1 GiB memory probe test (skipped on CI by default with env opt-in)

## Test plan
- [TEST-0316] Backpressure invariants and memory probe unit test

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0301], [STORY-0303], [STORY-0306]

## References
- `docs/WHITEPAPER.md` §4.7 (lines 6140–6172)
- Interfaces consumed: `PutObjectInterceptor` (defined in [STORY-0301]), `GetObjectHandler` (defined in [STORY-0303]), `UploadPartHandler` (defined in [STORY-0306])
