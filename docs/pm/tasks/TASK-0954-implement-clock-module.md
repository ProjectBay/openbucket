---
id: TASK-0954
title: Implement ClockModule with env-flag-driven provider selection
story: STORY-0318
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/clock/clock.module.ts` that provides `Clock` as `SystemClock` or `TestClock` depending on `process.env.OPENBUCKET_TEST_MODE === '1'`, and additionally exposes `TestClock` (so the test controller can inject it directly) only when in test mode.

## Files to create / modify
- `apps/backend/src/common/clock/clock.module.ts` — new

## Implementation notes
- Verbatim per §4.11:
  ```ts
  import { Module } from '@nestjs/common';
  import { Clock, SystemClock, TestClock } from './clock';

  @Module({
    providers: [
      {
        provide: Clock,
        useClass: process.env.OPENBUCKET_TEST_MODE === '1' ? TestClock : SystemClock,
      },
      ...(process.env.OPENBUCKET_TEST_MODE === '1' ? [TestClock] : []),
    ],
    exports: [Clock, ...(process.env.OPENBUCKET_TEST_MODE === '1' ? [TestClock] : [])],
  })
  export class ClockModule {}
  ```

## Acceptance criteria
- [ ] In production (`OPENBUCKET_TEST_MODE !== '1'`), only `Clock` (= `SystemClock`) is exported.
- [ ] In test mode (`OPENBUCKET_TEST_MODE === '1'`), both `Clock` (= `TestClock`) and `TestClock` are exported.

## Test obligations
- Unit: covered by [TEST-0324]
- E2E: covered by [TEST-0325]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0953]

## References
- `docs/WHITEPAPER.md` §4.11 (lines 6488–6505)
