---
id: TEST-0318
title: BackgroundService scheduler unit tests with fake timers
covers: [STORY-0313, TASK-0935, TASK-0936, TASK-0937, TASK-0938, TASK-0939]
status: done
level: unit
---

## Goal
Verify the no-pile-up guarantee, per-tick `RequestContext` wrapping, bootstrap ordering (orphan-scan first), graceful shutdown, and pile-up warning.

## Setup
- Jest with `jest.useFakeTimers()`.
- Stub `MikroORM` with a mock `RequestContext.create` that runs its callback inside a fake context.
- Stub each runner (`LifecycleSweepRunner`, `MultipartCleanupRunner`, `TrashPurgeRunner`, `OrphanScanRunner`) with controllable runners.

## Cases
1. Given `onApplicationBootstrap`, then `orphan-scan` `run()` is awaited BEFORE any `setInterval` is scheduled.
2. After bootstrap, three `setInterval` calls exist with intervals `60_000`, `5 * 60_000`, `5 * 60_000`.
3. Each `setInterval` handle is `.unref()`'d.
4. Given a tick is currently `inFlight`, when the interval fires again, then a debug log `Skipping <name>: previous tick still running` is emitted and the runner is NOT invoked.
5. Each tick callback executes inside `RequestContext.create(this.orm.em, ...)` (verified by spy).
6. A tick that throws is caught by `Logger.error` and does not propagate.
7. A tick whose `Date.now()` difference exceeds `intervalMs * 0.8` triggers `Logger.warn(\`Tick <name> took <ms>ms (interval <intervalMs>ms) — risk of pile-up\`)`.
8. `onApplicationShutdown` sets `shuttingDown = true`, calls `clearInterval` on each handle, and `await`s `Promise.allSettled` of in-flight ticks. After it returns, subsequent `fire(tick)` calls are no-ops.
9. Calling `onApplicationShutdown` twice is idempotent.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=background.service.spec.ts`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6205–6326)
