---
id: TEST-0319
title: LifecycleSweepRunner unit tests using TestClock
covers: [STORY-0314, TASK-0940, TASK-0941, TASK-0942, TASK-0943]
status: done
level: unit
---

## Goal
Verify the per-rule cursor paging, days-vs-date expiration evaluation, transactional `moveToTrash`, `setImmediate` yielding, and `MAX_BATCHES_PER_TICK` pause behavior.

## Setup
- Mock `LifecycleService`, `ObjectService`, `EntityManager`, `Clock` (TestClock).
- Use `jest.spyOn` on `setImmediate` to observe yields.

## Cases
1. Given a rule with `days: 7`, an object whose `createdAt` is 8 days ago is `isExpired`, one whose `createdAt` is 6 days ago is NOT.
2. Given a rule with `date: 2026-01-01`, `now = 2026-01-02` → `isExpired` true; `now = 2025-12-31` → false.
3. Given a rule and an initial cursor `'k0'`, `scanForLifecycle` is called with `{ afterKey: 'k0', limit: 500 }`.
4. After a non-empty batch, `saveCursor(ruleId, page[page.length-1].key)` is called once.
5. When a batch returns 0 rows, `saveCursor(ruleId, null)` is called and the rule loop breaks.
6. Each non-empty batch wraps `moveToTrash` calls inside `em.transactional`.
7. Between batches, `await new Promise((r) => setImmediate(r))` is observed (spy).
8. After 10 batches without exhaustion, the runner emits log `Rule <ruleId> paused at cursor <cursor>; resumes next tick`.
9. Multiple rules are processed sequentially.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=lifecycle-sweep.runner.spec.ts`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §4.10 (lines 6330–6438)
