---
id: TEST-0315
title: UV_THREADPOOL_SIZE ordering unit test
covers: [STORY-0310, TASK-0927, TASK-0928]
status: done
level: unit
---

## Goal
Verify that `process.env.UV_THREADPOOL_SIZE ??= '16';` is the first executable line of `main.ts` (before any `import`) and that a startup log line reports the effective value.

## Setup
- Read `apps/backend/src/main.ts` as text in the test.
- Spawn the built backend with no env override and capture stdout for one line.

## Cases
1. AST/grep: in `main.ts`, the first non-comment statement is the `UV_THREADPOOL_SIZE` assignment.
2. AST/grep: no `import` statement appears above that assignment.
3. Spawned bootstrap log includes `UV_THREADPOOL_SIZE=16`.
4. With `UV_THREADPOOL_SIZE=8` in the env, the same log line reports `UV_THREADPOOL_SIZE=8` (overrides preserved).

## Tooling
- Framework: jest, child_process
- Runner: `nx test backend --testPathPattern=uv-threadpool.spec.ts`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §4.6 (lines 6108–6137)
