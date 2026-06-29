---
id: STORY-0313
title: BackgroundService scheduler with no-pile-up semantics
epic: EPIC-04
status: done
size: M
risk: medium
---

## User story
As an operator, I want an in-process background scheduler that runs the lifecycle/multipart/trash/orphan ticks on intervals without piling up if one runs long, so that maintenance work proceeds without starving the request loop.

## Description
Implement `apps/backend/src/common/background/background.service.ts`. The service implements `OnApplicationBootstrap` (runs the one-shot orphan scan, then schedules `lifecycle-sweep` every `60_000` ms, `multipart-cleanup` every `5 * 60_000` ms, `trash-purge` every `5 * 60_000` ms) and `OnApplicationShutdown` (sets `shuttingDown = true`, clears intervals, awaits any in-flight tick via `Promise.allSettled`). Each tick handle keeps an `inFlight: Promise<void>` — if it is set when `fire` is called, the firing is skipped (debug log). Each tick runs inside `RequestContext.create(this.orm.em, async () => runner())` so MikroORM identity maps do not leak. The interval handle is `.unref()`'d so it doesn't keep the loop alive. If a tick exceeds 80% of its interval, a warning logs the pile-up risk.

## Acceptance criteria
- [ ] `BackgroundService` implements `OnApplicationBootstrap` and `OnApplicationShutdown`.
- [ ] `onApplicationBootstrap` runs `orphan-scan` once and schedules the three recurring ticks with intervals `60_000`, `5 * 60_000`, `5 * 60_000`.
- [ ] Firing while `inFlight` is set emits a debug log `Skipping <name>: previous tick still running` and does not start a new run.
- [ ] `setInterval` handles are `.unref()`'d.
- [ ] Each tick runs inside `RequestContext.create(this.orm.em, ...)`.
- [ ] Tick exceptions are caught and logged via `Logger.error`.
- [ ] `onApplicationShutdown` clears all intervals and awaits `Promise.allSettled(ticks.map(t => t.inFlight ?? Promise.resolve()))`.
- [ ] When a tick runs > `intervalMs * 0.8`, a warning logs `Tick <name> took <ms>ms (interval <intervalMs>ms) — risk of pile-up`.
- [ ] `nx test backend --testPathPattern=background.service.spec.ts` passes (uses fake timers).

## Tasks
- [TASK-0935] Implement TickHandle interface and ticks[] array
- [TASK-0936] Implement schedule/fire/execute with no-pile-up guard and RequestContext wrap
- [TASK-0937] Implement runOnce + onApplicationBootstrap to launch orphan scan once and then schedule recurring ticks
- [TASK-0938] Implement onApplicationShutdown to clearInterval and await inFlight ticks
- [TASK-0939] Register BackgroundService and runner providers in a BackgroundModule

## Test plan
- [TEST-0318] BackgroundService scheduler unit tests with fake timers

## Dependencies
- Blocks: [STORY-0314], [STORY-0315], [STORY-0316], [STORY-0317], [STORY-0319]
- Blocked by: _none_ (MikroORM from [EPIC-03])

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6205–6326)
- Interfaces consumed: `MikroORM`/`RequestContext` (defined in [EPIC-03]), `LifecycleSweepRunner` (defined in [STORY-0314]), `MultipartCleanupRunner` (defined in [STORY-0315]), `TrashPurgeRunner` (defined in [STORY-0316]), `OrphanScanRunner` (defined in [STORY-0317])
- Interfaces produced: `BackgroundService`, `TickHandle`
