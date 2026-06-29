---
id: TASK-0928
title: Log effective UV thread-pool size on bootstrap
story: STORY-0310
status: done
type: implementation
size: XS
---

## Description
During bootstrap (after the Nest app is created), log a single line that reports the effective `process.env.UV_THREADPOOL_SIZE` so operators can confirm the value from logs without inspecting the process env.

## Files to create / modify
- `apps/backend/src/main.ts` — modify

## Implementation notes
- Use the Pino logger via `app.useLogger(app.get(Logger))` (already wired by EPIC-01) — emit a single `log` call: `UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}`.

## Acceptance criteria
- [ ] A startup log line contains `UV_THREADPOOL_SIZE=<value>` exactly once.

## Test obligations
- Unit: covered by [TEST-0315]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0927]

## References
- `docs/WHITEPAPER.md` §4.6 (lines 6108–6137)
