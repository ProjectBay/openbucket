---
id: STORY-0318
title: Clock abstraction with TestClock and OPENBUCKET_TEST_MODE advance endpoint
epic: EPIC-04
status: done
size: S
risk: medium
---

## User story
As a developer, I want every time-reading code path to go through a `Clock` service and a gated `/api/admin/_test/advance-clock` endpoint to fast-forward it, so that lifecycle conformance tests run in ~60 s instead of 24 hours.

## Description
Implement `apps/backend/src/common/clock/clock.ts` exporting `abstract class Clock { abstract nowMs(): number; now(): Date }`, `class SystemClock extends Clock` (returns `Date.now()`), and `class TestClock extends Clock` with `private offsetMs = 0`, `nowMs() { return Date.now() + this.offsetMs; }`, `advance(ms: number)` (`ms < 0` throws `'TestClock can only advance forward'`), and `reset()`. Implement `apps/backend/src/common/clock/clock.module.ts` that provides `Clock` as either `SystemClock` or `TestClock` based on `process.env.OPENBUCKET_TEST_MODE === '1'`, and additionally exposes `TestClock` itself only in test mode. Implement `apps/backend/src/admin/test/test.controller.ts` mounted only when the same env flag is set, exposing `POST /api/admin/_test/advance-clock` with body `{ ms: number }`, validating `typeof body?.ms === 'number' && body.ms >= 0` (else `BadRequestException('ms must be a non-negative number')`), calling `clock.advance(body.ms)`, and returning `{ offsetMs }`. The conditional `testControllers = process.env.OPENBUCKET_TEST_MODE === '1' ? [TestController] : []` is consumed by `AppModule` (owned by EPIC-01).

## Acceptance criteria
- [x] `Clock`, `SystemClock`, `TestClock` exported from `apps/openbucket-backend/src/common/clock/clock.ts` (TEST-0324 cases 1–5).
- [x] `TestClock.advance(-1)` throws `Error('TestClock can only advance forward')` (case 4).
- [x] `ClockModule` provides `TestClock` iff `OPENBUCKET_TEST_MODE === '1'`, else `SystemClock` — verified by the TEST-0325 e2e (two spawned backend variants); the in-process module-cache variant is harder to assert in jest, documented in TEST-0324 case 6+7.
- [x] `TestClock` exported by the module only in test mode (same e2e-verified path).
- [x] `TestController` registered only in test mode; production POST returns 404 (TEST-0325 case 1).
- [x] `POST /api/admin/_test/advance-clock { ms: 86400000 }` → 200 with `{ offsetMs ≈ ms }` (case 2; `@HttpCode(200)` added so this isn't Nest's POST-default 201).
- [x] `POST /api/admin/_test/advance-clock { ms: -1 }` and non-numeric `ms` → 400 (cases 3, 4 status-only at the HTTP boundary; the exact `'ms must be a non-negative number'` message is asserted at the controller level by TEST-0324 case 9 — see realization note).
- [x] Backend suite 173/173; e2e 15 passed / 4 POSIX-skipped.

## Tasks
- [TASK-0953] Implement Clock, SystemClock, TestClock
- [TASK-0954] Implement ClockModule with env-flag-driven provider selection
- [TASK-0955] Implement TestController with body validation and clock.advance
- [TASK-0956] Wire the `testControllers` array into AppModule for conditional registration

## Test plan
- [TEST-0324] Clock and TestClock unit tests
- [TEST-0325] Advance-clock endpoint e2e via supertest

## Implementation notes
- `ClockModule` is `@Global()` so consumers don't have to import it; the
  `OPENBUCKET_TEST_MODE` env is read at module-load time (no DI on the flag).
- `TestController` (the M0/STORY-0015 controller at `admin/_test/`) is
  *extended* with `POST /advance-clock` rather than introduced as a new
  `admin/test/` controller. Same gate (the conditional `TestModule` import in
  AppModule). `@HttpCode(200)` makes the RPC-style POST return 200, not
  Nest's POST-default 201.
- TEST-0324 cases 6+7 (in-process `ClockModule` provider-selection branch)
  are covered by TEST-0325's two-backend spawn instead of by an in-process
  module re-instantiation; the env-driven branch + jest's module cache make
  the in-process variant brittle.
- TEST-0325 case 3 asserts status only — the BadRequestException body at the
  `/_test/*` HTTP boundary currently renders as Express's default HTML 400
  page rather than the AdminExceptionFilter's JSON shape. This is an M0
  filter-coverage gap for that path subtree and is independent of STORY-0318;
  the exact `'ms must be a non-negative number'` message is fully asserted at
  the controller level by TEST-0324 case 9.

## Dependencies
- Blocks: [STORY-0314], [STORY-0315], [STORY-0316]
- Blocked by: _none_ (AppModule wiring from [EPIC-01])

## References
- `docs/WHITEPAPER.md` §4.11 (lines 6447–6543)
- Interfaces consumed: AppModule registration hook from [EPIC-01]
- Interfaces produced: `Clock`, `SystemClock`, `TestClock`, `ClockModule`, `TestController`
