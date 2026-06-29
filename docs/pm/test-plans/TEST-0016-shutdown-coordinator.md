---
id: TEST-0016
title: Shutdown coordinator unit behavior
covers: [STORY-0015, TASK-0040, TASK-0041, TASK-0042, TASK-0043]
status: done
level: unit
---

## Goal
Verify `installShutdownHandlers` registers signal listeners, the inner `shutdown` function is idempotent, races drain against the deadline, and exits with the documented code based on outcome.

## Setup
- Mock `process.exit` (Jest spy) and `process.on`. Provide a `INestApplication` stub with `getHttpServer` returning a fake `Server.close((err) => cb())`, `get(ShutdownState)`, `get(AppConfigService)` returning `{ shutdownDrainMs: 50 }`, and `close()` resolving.

## Cases
1. Given `installShutdownHandlers(app, { drainTimeoutMs: 50 })`, then `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` are both registered.
2. Given a SIGTERM during `_inFlight === 0`, then the coordinator logs `'All in-flight requests completed.'`, awaits `app.close()`, and calls `process.exit(0)`.
3. Given a SIGTERM with `_inFlight === 1` and the request never leaves, then after 50 ms the coordinator logs the `'Drain deadline (50ms) elapsed with 1 in-flight requests; closing anyway.'` warning and exits with code 1.
4. Given a SIGTERM mid-shutdown (second signal), then the second `shutdown('SIGTERM')` logs `'Received SIGTERM again; forcing exit.'` and calls `process.exit(1)`.
5. Given `app.close()` throws, then the coordinator logs `'Error during app.close().'` and exits with code 1.
6. Given the inner `setTimeout`, when the timer would prevent the event loop from exiting alone, then `.unref()` has been called (the timer does not keep the process alive on its own).

## Tooling
- Framework: jest with fake timers
- Runner: `nx test openbucket-backend --testPathPattern=shutdown.spec`

## Pass criteria
- [ ] All six cases pass.
- [ ] `state.beginShutdown()` is called exactly once per process.

## References
- `docs/WHITEPAPER.md` §1.10 (lines 986–1051)
