---
id: TASK-0953
title: Implement Clock, SystemClock, TestClock
story: STORY-0318
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/clock/clock.ts` with the abstract `Clock` and concrete `SystemClock` / `TestClock` classes per §4.11.

## Files to create / modify
- `apps/backend/src/common/clock/clock.ts` — new

## Implementation notes
- Verbatim per §4.11:
  ```ts
  export abstract class Clock {
    abstract nowMs(): number;
    now(): Date {
      return new Date(this.nowMs());
    }
  }

  @Injectable()
  export class SystemClock extends Clock {
    nowMs(): number {
      return Date.now();
    }
  }

  @Injectable()
  export class TestClock extends Clock {
    private offsetMs = 0;
    nowMs(): number {
      return Date.now() + this.offsetMs;
    }
    advance(ms: number): void {
      if (ms < 0) throw new Error('TestClock can only advance forward');
      this.offsetMs += ms;
    }
    reset(): void {
      this.offsetMs = 0;
    }
  }
  ```
- Error message verbatim: `'TestClock can only advance forward'`.

## Acceptance criteria
- [ ] `Clock`, `SystemClock`, `TestClock` are exported.
- [ ] `TestClock.advance(-1)` throws `Error('TestClock can only advance forward')`.
- [ ] `TestClock.now().getTime() === Date.now() + offsetMs`.

## Test obligations
- Unit: covered by [TEST-0324]
- E2E: covered by [TEST-0325]
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.11 (lines 6453–6483)
