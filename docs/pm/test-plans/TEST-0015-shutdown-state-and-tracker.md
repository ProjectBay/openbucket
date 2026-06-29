---
id: TEST-0015
title: ShutdownState semantics and tracker interceptor
covers: [STORY-0014, TASK-0037, TASK-0038, TASK-0039]
status: done
level: unit
---

## Goal
Verify `ShutdownState`'s counter and drain-queue semantics, and that `ShutdownTrackerInterceptor` increments/decrements the counter on both success and error paths.

## Setup
- Instantiate `ShutdownState` directly. For the interceptor, mock `CallHandler.handle()` to return controllable RxJS observables.

## Cases
1. Given a fresh `ShutdownState`, when `enter(); enter(); leave();`, then `inFlight === 1`.
2. Given `_inFlight === 0`, when `leave()` is called, then `_inFlight` stays `0` (floors).
3. Given `_inFlight === 2` and two awaiters of `whenDrained()`, when `leave(); leave();`, then both promises resolve and the internal `drained` set is empty.
4. Given `_inFlight === 0`, then `whenDrained()` returns a resolved promise (synchronous resolution).
5. Given `beginShutdown()` is called twice, then `isShuttingDown === true` and `abortController.signal.aborted === true`; the second call is a no-op (no extra abort).
6. Given a successful `handle()` observable, when piped through `ShutdownTrackerInterceptor`, then `enter()` runs before emission and `leave()` runs on completion.
7. Given an erroring `handle()` observable, when piped through the interceptor, then `leave()` still runs (via `finalize`).

## Tooling
- Framework: jest
- Runner: `nx test openbucket-backend --testPathPattern=shutdown-state.service.spec`

## Pass criteria
- [ ] All seven cases pass.
- [ ] `whenDrained` does not leak promise resolvers after fanout.

## References
- `docs/WHITEPAPER.md` §1.10 (lines 920–984)
