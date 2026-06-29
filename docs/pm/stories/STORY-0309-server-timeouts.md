---
id: STORY-0309
title: HTTP server timeouts calibrated for object storage
epic: EPIC-04
status: done
size: XS
risk: low
---

## User story
As an operator, I want the HTTP server's request/header/keep-alive timeouts tuned for multi-GB transfers, so that a slow PUT is not closed mid-stream and an idle connection behind an LB is not racy.

## Description
After `await app.listen(port)` in `apps/backend/src/main.ts`, set `server.requestTimeout = 0`, `server.headersTimeout = 60_000`, `server.keepAliveTimeout = 75_000`, `server.timeout = 0` (per the §4.5 summary table). Document the rationale inline as a comment block matching §4.5. Connection drain on shutdown is implemented separately in [STORY-0319].

## Acceptance criteria
- [ ] `server.requestTimeout === 0` after listen.
- [ ] `server.headersTimeout === 60_000`.
- [ ] `server.keepAliveTimeout === 75_000`.
- [ ] `server.timeout === 0`.
- [ ] Source contains the inline rationale comment naming the §4.5 reasoning.
- [ ] `nx test backend --testPathPattern=main.spec.ts` (or an equivalent bootstrap spec) asserts the four values.

## Tasks
- [TASK-0925] Set the four timeouts on the listening server in main.ts
- [TASK-0926] Add the rationale comment block from §4.5

## Test plan
- [TEST-0314] Server timeout configuration unit test

## Dependencies
- Blocks: _none_
- Blocked by: _none_ (main.ts bootstrap from [EPIC-01])

## References
- `docs/WHITEPAPER.md` §4.5 (lines 6036–6105)
- Interfaces consumed: bootstrap from [EPIC-01]
