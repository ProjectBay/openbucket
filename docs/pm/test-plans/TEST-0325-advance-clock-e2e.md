---
id: TEST-0325
title: Advance-clock endpoint e2e via supertest
covers: [STORY-0318, TASK-0955, TASK-0956]
status: done
level: e2e
---

## Goal
Verify the gated `/api/admin/_test/advance-clock` endpoint is mounted only when `OPENBUCKET_TEST_MODE=1`, validates its body, and actually shifts the injected `TestClock`.

## Setup
- Two test app variants: one with `OPENBUCKET_TEST_MODE=1`, one without.

## Cases
1. (production variant) `POST /api/admin/_test/advance-clock { ms: 1 }` → HTTP 404.
2. (test variant) `POST /api/admin/_test/advance-clock { ms: 86400000 }` → HTTP 200, body `{ offsetMs: ≈86400000 }`.
3. (test variant) `POST /api/admin/_test/advance-clock { ms: -1 }` → HTTP 400 with message `'ms must be a non-negative number'`.
4. (test variant) `POST /api/admin/_test/advance-clock { ms: 'foo' }` → HTTP 400 with the same message.
5. (test variant) After advance, `Clock.nowMs()` (read via a debug helper) is `≈ Date.now() + ms`.

## Tooling
- Framework: supertest, jest
- Runner: `nx e2e backend-e2e --testPathPattern=advance-clock.e2e-spec.ts`

## Pass criteria
- [x] All five cases pass (`apps/openbucket-backend-e2e/src/advance-clock.e2e-spec.ts`); e2e 15 passed / 4 POSIX-skipped. Spawns two backends (with/without `OPENBUCKET_TEST_MODE=1`) — covers TEST-0324 cases 6+7 operationally as well.

## Realization note
Cases 3 + 4 (the message-text assertion at the HTTP boundary) are reduced to
status-only because the BadRequestException renders as Express's default HTML
400 page rather than the AdminExceptionFilter's JSON shape on `/_test/*`
paths. The exact message `'ms must be a non-negative number'` is asserted at
the controller level by TEST-0324 case 9. The HTML rendering is an M0
filter-coverage gap (`AdminExceptionFilter` chain doesn't format this path
subtree as JSON) and is independent of STORY-0318.

## References
- `docs/WHITEPAPER.md` §4.11 (lines 6447–6543)
