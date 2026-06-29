---
id: TASK-0955
title: Implement TestController with body validation and clock.advance
story: STORY-0318
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/admin/test/test.controller.ts` exposing `POST /api/admin/_test/advance-clock`. Validate `{ ms: number, ms >= 0 }`, otherwise `BadRequestException('ms must be a non-negative number')`. Calls `TestClock.advance(body.ms)` and returns `{ offsetMs }`.

## Files to create / modify
- `apps/backend/src/admin/test/test.controller.ts` — new

## Implementation notes
- Verbatim per §4.11:
  ```ts
  @Controller('api/admin/_test')
  export class TestController {
    constructor(@Inject(TestClock) private readonly clock: TestClock) {}

    @Post('advance-clock')
    advance(@Body() body: { ms: number }): { offsetMs: number } {
      if (typeof body?.ms !== 'number' || body.ms < 0) {
        throw new BadRequestException('ms must be a non-negative number');
      }
      this.clock.advance(body.ms);
      return { offsetMs: (this.clock as TestClock & { offsetMs?: number }).nowMs() - Date.now() };
    }
  }
  ```
- File-level JSDoc per §4.11: "Mounted only when `OPENBUCKET_TEST_MODE=1`. The module that imports this controller checks the env flag and excludes the controller otherwise — a missing module dependency at production boot would be a 500, which is what we want."

## Acceptance criteria
- [ ] `POST /api/admin/_test/advance-clock { ms: 86400000 }` → `200 { offsetMs }`.
- [ ] `POST /api/admin/_test/advance-clock { ms: -1 }` → `400 'ms must be a non-negative number'`.
- [ ] `POST /api/admin/_test/advance-clock { ms: 'foo' }` → `400 'ms must be a non-negative number'`.
- [ ] When mounted, calls `TestClock.advance(body.ms)`.

## Test obligations
- Unit: covered by [TEST-0324]
- E2E: covered by [TEST-0325]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0954]

## References
- `docs/WHITEPAPER.md` §4.11 (lines 6510–6534)
