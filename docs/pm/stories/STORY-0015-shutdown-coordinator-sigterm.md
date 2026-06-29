---
id: STORY-0015
title: Implement SIGTERM shutdown coordinator with drain deadline
epic: EPIC-01
status: done
size: M
risk: high
---

## User story
As an operator, I want SIGTERM and SIGINT to trigger an orderly shutdown that (1) flips readiness to draining, (2) stops accepting new connections, (3) waits up to `SHUTDOWN_DRAIN_MS` for in-flight requests, (4) closes Nest (and via it MikroORM), then exits with code 0 on clean drain or 1 on timeout, so that deploys are zero-downtime and a stuck shutdown does not silently corrupt state.

## Description
Implement `apps/backend/src/bootstrap/shutdown.ts` per §1.10. Export `installShutdownHandlers(app: INestApplication, _opts: ShutdownOptions): void` where `interface ShutdownOptions { drainTimeoutMs: number }`. Read `drainTimeoutMs` from `AppConfigService.shutdownDrainMs` (not from `_opts`, per §1.10). Inside `shutdown(signal)`: idempotency guard (second signal forces `process.exit(1)`), call `state.beginShutdown()`, call `server.close()` with an error log, race `state.whenDrained()` against a `setTimeout(...).unref()` timer, log either `'All in-flight requests completed.'` or the `'Drain deadline ... elapsed with N in-flight requests'` warning, call `await app.close()` (closes MikroORM via its module hook), and `process.exit(outcome === 'timeout' ? 1 : 0)`. Register both `SIGTERM` and `SIGINT` listeners.

## Acceptance criteria
- [ ] `installShutdownHandlers` signature matches `(app: INestApplication, _opts: ShutdownOptions): void` verbatim.
- [ ] `drainTimeoutMs` is sourced from `AppConfigService.shutdownDrainMs`.
- [ ] Receiving SIGTERM during an in-flight 30 s request causes the process to wait until the request completes, then exit 0.
- [ ] Receiving SIGTERM with an in-flight request that exceeds `SHUTDOWN_DRAIN_MS` causes a `Drain deadline ... elapsed` warning and exit code 1.
- [ ] A second SIGTERM mid-shutdown logs `Received SIGTERM again; forcing exit.` and calls `process.exit(1)`.
- [ ] `app.close()` is awaited so MikroORM's `onApplicationShutdown` runs.
- [ ] Both `SIGTERM` and `SIGINT` are registered.

## Tasks
- [TASK-0040] Implement installShutdownHandlers entry point
- [TASK-0041] Implement idempotency and double-signal forced exit
- [TASK-0042] Implement drain race against deadline
- [TASK-0043] Wire app.close() and process.exit semantics

## Test plan
- [TEST-0016] Shutdown coordinator (unit)
- [TEST-0017] SIGTERM drain end-to-end (e2e)

## Dependencies
- Blocks: [STORY-0002]
- Blocked by: [STORY-0011], [STORY-0014]

## Status note
Closed at the M0→M1 boundary. Code (TASK-0040..0043) and the unit test
(TEST-0016) were already complete and green. TEST-0017 (SIGTERM drain **e2e**)
now exists in `openbucket-backend-e2e/src/shutdown.e2e-spec.ts` and covers all
four cases (clean drain→exit 0; deadline exceeded→exit 1; SIGINT→exit 0; double
SIGTERM forces exit 1) by spawning the built backend and a gated
`OPENBUCKET_TEST_MODE=1` slow route. **Platform note:** the suite is POSIX-only
(`describe.skip` on win32, where `child.kill('SIGTERM')` maps to a hard
TerminateProcess) — it runs for real in Linux CI and is skipped on Windows dev.

## References
- `docs/WHITEPAPER.md` §1.10 (lines 986–1051)
- Interfaces consumed: `ShutdownState` (STORY-0014), `AppConfigService.shutdownDrainMs` (STORY-0011)
- Interfaces produced: `installShutdownHandlers`, `ShutdownOptions` (consumed by STORY-0002)
