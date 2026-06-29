---
id: TASK-0041
title: Implement idempotency and double-signal forced exit
story: STORY-0015
status: done
type: implementation
size: XS
---

## Description
Inside `shutdown(signal)`, guard against repeated entry per §1.10: if `shuttingDown` is already true, log `'Received <signal> again; forcing exit.'` and call `process.exit(1)`. Otherwise set the flag, log `'Received <signal>; beginning graceful shutdown.'`, and proceed to drain.

## Files to create / modify
- `apps/openbucket-backend/src/bootstrap/shutdown.ts` — modify

## Implementation notes
- Quote §1.10 (lines 1004–1011) verbatim:
  ```ts
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      logger.warn(`Received ${signal} again; forcing exit.`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.log(`Received ${signal}; beginning graceful shutdown.`);
    state.beginShutdown();
    ...
  }
  ```
- `state.beginShutdown()` is called once per process, immediately after the idempotency check.

## Acceptance criteria
- [ ] First SIGTERM logs `'Received SIGTERM; beginning graceful shutdown.'`.
- [ ] Second SIGTERM logs `'Received SIGTERM again; forcing exit.'` and calls `process.exit(1)`.
- [ ] `state.beginShutdown()` is called exactly once.

## Test obligations
- Unit: covered by [TEST-0016]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0040]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 1004–1012)
