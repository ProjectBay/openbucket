---
id: STORY-0314
title: LifecycleSweepRunner with cursor pagination and days/date eval
epic: EPIC-04
status: done
size: M
risk: medium
---

## User story
As an operator, I want active lifecycle expiration rules swept on a 60-second tick, paging through objects with a per-rule cursor and yielding between batches, so that a long sweep does not block requests and pauses cleanly when its time slice expires.

## Description
Implement `apps/backend/src/common/background/lifecycle-sweep.runner.ts`. The runner loads `LifecycleService.activeExpirationRules()` and the per-rule cursor from `LifecycleService.loadCursor(ruleId)`. For each rule it pages `ObjectService.scanForLifecycle({ bucket, prefix, afterKey: cursor, limit: BATCH_SIZE })` with `BATCH_SIZE = 500`. Each batch's expired set is filtered by `isExpired(obj, rule, now)` (which evaluates `rule.date` as `now.getTime() >= rule.date.getTime()`, else `rule.days` as `ageMs >= rule.days * 24 * 60 * 60 * 1000`). Expired objects are moved to trash inside a single `em.transactional` per batch using `ObjectService.moveToTrash`. After each batch the runner saves the cursor and `await new Promise((r) => setImmediate(r))` to yield. After `MAX_BATCHES_PER_TICK = 10` batches per rule the sweep pauses (resumes next tick). When a page is empty the cursor is reset to `null`. The `Clock` (see [STORY-0318]) provides `nowMs()`.

## Acceptance criteria
- [ ] `BATCH_SIZE = 500` and `MAX_BATCHES_PER_TICK = 10` are exported as constants.
- [ ] For each rule, the runner uses `LifecycleService.loadCursor(rule.ruleId)` as `afterKey`.
- [ ] After each non-empty batch, `LifecycleService.saveCursor(rule.ruleId, cursor)` is called with `page[page.length - 1].key`.
- [ ] When `page.length === 0` the cursor is reset to `null` and the rule's loop breaks.
- [ ] `moveToTrash` is called inside `em.transactional` once per batch.
- [ ] Between batches the runner awaits `new Promise((r) => setImmediate(r))` (verified via spy).
- [ ] `isExpired` returns true for a `rule.date` when `now.getTime() >= rule.date.getTime()`.
- [ ] `isExpired` returns true for a `rule.days` when `(now - obj.createdAt) >= rule.days * 24 * 60 * 60 * 1000`.
- [ ] After `MAX_BATCHES_PER_TICK` the runner logs `Rule <ruleId> paused at cursor <cursor>; resumes next tick`.
- [ ] `nx test backend --testPathPattern=lifecycle-sweep.runner.spec.ts` passes.

## Tasks
- [TASK-0940] Implement ExpirationRule interface and isExpired (days OR date)
- [TASK-0941] Implement paged sweep loop with cursor save and setImmediate yield
- [TASK-0942] Implement per-batch transactional moveToTrash
- [TASK-0943] Wire MAX_BATCHES_PER_TICK pause log

## Test plan
- [TEST-0319] LifecycleSweepRunner unit tests using TestClock
- [TEST-0320] Lifecycle expiration e2e using advance-clock

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0313], [STORY-0318]

## References
- `docs/WHITEPAPER.md` §4.10 (lines 6330–6438)
- Interfaces consumed: `LifecycleService.activeExpirationRules/loadCursor/saveCursor` (defined in [EPIC-03]), `ObjectService.scanForLifecycle/moveToTrash` (defined in [EPIC-03]), `EntityManager` (defined in [EPIC-03]), `Clock.nowMs` (defined in [STORY-0318])
- Interfaces produced: `LifecycleSweepRunner`, `ExpirationRule`
