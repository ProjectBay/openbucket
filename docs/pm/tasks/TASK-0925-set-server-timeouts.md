---
id: TASK-0925
title: Set HTTP server timeouts in main.ts after listen
story: STORY-0309
status: done
type: implementation
size: XS
---

## Description
After `await app.listen(port)`, set the four streaming-relevant timeouts on the returned `server` instance per §4.5.

## Files to create / modify
- `apps/backend/src/main.ts` — modify

## Implementation notes
- Verbatim per §4.5:
  ```ts
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 75_000;
  server.timeout = 0;
  ```
- Connection drain on shutdown is implemented in [STORY-0319].

## Acceptance criteria
- [ ] `server.requestTimeout === 0`.
- [ ] `server.headersTimeout === 60_000`.
- [ ] `server.keepAliveTimeout === 75_000`.
- [ ] `server.timeout === 0`.

## Test obligations
- Unit: covered by [TEST-0314]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.5 (lines 6087–6093)
