---
id: TEST-0324
title: Clock and TestClock unit tests
covers: [STORY-0318, TASK-0953, TASK-0954, TASK-0955, TASK-0956]
status: done
level: unit
---

## Goal
Verify `SystemClock` and `TestClock` semantics, the `ClockModule` provider-selection branch on `OPENBUCKET_TEST_MODE`, and the conditional registration of `TestController`.

## Setup
- Jest, no Nest app boot (manual instantiation for class tests).
- For module tests, build a `Test.createTestingModule({ imports: [ClockModule] })` with the env flag toggled.

## Cases
1. `SystemClock.nowMs()` ≈ `Date.now()` (within a few ms).
2. `TestClock.nowMs()` === `Date.now() + offsetMs`.
3. `TestClock.advance(0)` is a no-op.
4. `TestClock.advance(-1)` throws `Error('TestClock can only advance forward')`.
5. `TestClock.reset()` sets `offsetMs` back to 0.
6. With `OPENBUCKET_TEST_MODE=1`, the resolved `Clock` instance is a `TestClock` and the module exports `TestClock`.
7. With `OPENBUCKET_TEST_MODE` unset, the resolved `Clock` is a `SystemClock` and `TestClock` is not exported.
8. `TestController.advance({ ms: 1000 })` calls `TestClock.advance(1000)` and returns `{ offsetMs }`.
9. `TestController.advance({ ms: -1 })` throws `BadRequestException('ms must be a non-negative number')`.
10. `TestController.advance({ ms: 'foo' })` (non-numeric) throws the same `BadRequestException`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=clock.spec.ts`

## Pass criteria
- [x] Cases 1–5 + 8–10 pass at the class/controller level (`apps/openbucket-backend/src/common/clock/clock.spec.ts`). Backend suite 173/173.
- [~] Cases 6+7 (in-process `ClockModule` provider-selection branch) — verified end-to-end by TEST-0325 (two spawned backends with/without `OPENBUCKET_TEST_MODE=1`); the in-jest in-process variant is brittle under jest's module cache.

## References
- `docs/WHITEPAPER.md` §4.11 (lines 6447–6543)
