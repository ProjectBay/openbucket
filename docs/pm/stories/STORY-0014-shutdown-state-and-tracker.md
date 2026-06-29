---
id: STORY-0014
title: Implement ShutdownState service and in-flight tracker interceptor
epic: EPIC-01
status: done
size: S
risk: medium
---

## User story
As a developer, I want a singleton `ShutdownState` that tracks the in-flight request count and exposes an `AbortController` plus a `whenDrained()` promise, and a global interceptor that increments/decrements the counter around every request, so that the shutdown coordinator can wait deterministically for traffic to drain.

## Description
Implement `apps/backend/src/common/shutdown-state.service.ts` exposing `isShuttingDown: boolean`, `inFlight: number`, `abortController: AbortController`, `beginShutdown(): void` (idempotent), `enter()` / `leave()`, and `whenDrained(): Promise<void>` per §1.10. Implement `apps/backend/src/common/interceptors/shutdown-tracker.interceptor.ts` that calls `state.enter()` then pipes `next.handle()` through `finalize(() => state.leave())`. The `_inFlight` counter floors at zero; reaching zero resolves all queued drain promises.

## Acceptance criteria
- [ ] `ShutdownState.beginShutdown()` flips `isShuttingDown` and calls `abortController.abort()`; second call is a no-op.
- [ ] `enter()` / `leave()` keep an accurate counter; `leave()` cannot drop below 0.
- [ ] `whenDrained()` resolves immediately when `_inFlight === 0`, otherwise queues until next `leave()` that hits zero.
- [ ] `ShutdownTrackerInterceptor` increments before `next.handle()` and decrements via `finalize(...)` on both success and error.
- [ ] Both classes are registered as providers in `CommonModule` (consumed by STORY-0008).

## Tasks
- [TASK-0037] Implement ShutdownState service
- [TASK-0038] Implement whenDrained promise queue
- [TASK-0039] Implement ShutdownTrackerInterceptor

## Test plan
- [TEST-0015] ShutdownState and tracker interceptor (unit)

## Dependencies
- Blocks: [STORY-0008], [STORY-0012], [STORY-0015]
- Blocked by: [STORY-0001]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 920–985)
- Interfaces produced: `ShutdownState` (consumed by STORY-0012, STORY-0015, EPIC-04 background workers); `ShutdownTrackerInterceptor` (consumed by STORY-0008)
