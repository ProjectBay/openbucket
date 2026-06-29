---
id: TEST-0314
title: Server timeout configuration unit test
covers: [STORY-0309, TASK-0925, TASK-0926]
status: done
level: unit
---

## Goal
Assert the four timeout values are applied to the HTTP server after `await app.listen(...)`.

## Setup
- Bootstrap the Nest app in test mode against an ephemeral port.

## Cases
1. After listen, `server.requestTimeout === 0`.
2. `server.headersTimeout === 60_000`.
3. `server.keepAliveTimeout === 75_000`.
4. `server.timeout === 0`.
5. The rationale comment block referencing `§4.5` is present in `main.ts` (grep assertion).

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=server-timeouts.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §4.5 (lines 6036–6105)
