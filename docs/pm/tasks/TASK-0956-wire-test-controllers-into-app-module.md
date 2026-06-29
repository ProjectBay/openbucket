---
id: TASK-0956
title: Wire conditional testControllers array into AppModule
story: STORY-0318
status: done
type: infra
size: XS
---

## Description
In `app.module.ts` (owned by EPIC-01), include `TestController` only when `OPENBUCKET_TEST_MODE === '1'` via a `testControllers` array spread into `controllers`.

## Files to create / modify
- `apps/backend/src/app.module.ts` — modify (add the conditional spread)

## Implementation notes
- Verbatim per §4.11:
  ```ts
  const testControllers = process.env.OPENBUCKET_TEST_MODE === '1' ? [TestController] : [];
  ```
- The Module decorator should spread `...testControllers` into `controllers`.

## Acceptance criteria
- [ ] In production, a request to `POST /api/admin/_test/advance-clock` returns 404.
- [ ] With `OPENBUCKET_TEST_MODE=1`, the same request is routed to `TestController`.

## Test obligations
- Unit: covered by [TEST-0324]
- E2E: covered by [TEST-0325]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0955]

## References
- `docs/WHITEPAPER.md` §4.11 (lines 6537–6543)
