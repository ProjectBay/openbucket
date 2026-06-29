---
id: STORY-0310
title: UV_THREADPOOL_SIZE=16 before any require
epic: EPIC-04
status: done
size: XS
risk: low
---

## User story
As an operator, I want the libuv thread pool sized to 16 before any `require`, so that concurrent multipart parts and SQLite fsyncs do not queue behind a default pool of 4.

## Description
At the very top of `apps/backend/src/main.ts`, before any `import`, set `process.env.UV_THREADPOOL_SIZE ??= '16';`. Then proceed with imports. Also add `ENV UV_THREADPOOL_SIZE=16` to the production Dockerfile (Dockerfile is owned by EPIC-06; this Story files the dependency note). The number 16 matches the v1 concurrent-part cap and is bounded above to avoid the 512 KB-per-thread stack cost on small containers.

## Acceptance criteria
- [ ] `apps/backend/src/main.ts` first executable line is `process.env.UV_THREADPOOL_SIZE ??= '16';` (or trivially equivalent).
- [ ] The setting appears before any `import` statement.
- [ ] A boot-time log line records the effective pool size for ops visibility.
- [ ] `nx test backend --testPathPattern=uv-threadpool.spec.ts` (a process-spawn or AST check) asserts the line ordering.

## Tasks
- [TASK-0927] Set UV_THREADPOOL_SIZE default to 16 at top of main.ts
- [TASK-0928] Log effective pool size on bootstrap for ops visibility

## Test plan
- [TEST-0315] UV_THREADPOOL_SIZE ordering unit test

## Dependencies
- Blocks: _none_
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.6 (lines 6108–6137)
- Interfaces consumed: bootstrap from [EPIC-01]
