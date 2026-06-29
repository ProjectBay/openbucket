---
id: TASK-0940
title: Implement ExpirationRule interface and isExpired (days OR date)
story: STORY-0314
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/background/lifecycle-sweep.runner.ts` with the `ExpirationRule` interface and the `private isExpired(obj, rule, now)` method.

## Files to create / modify
- `apps/backend/src/common/background/lifecycle-sweep.runner.ts` — new

## Implementation notes
- Verbatim per §4.10:
  ```ts
  export interface ExpirationRule {
    readonly ruleId: string;
    readonly bucket: string;
    readonly prefix: string;
    /** Either `days` OR `date` — never both. */
    readonly days?: number;
    readonly date?: Date;
  }

  private isExpired(obj: { createdAt: Date }, rule: ExpirationRule, now: Date): boolean {
    if (rule.date) {
      return now.getTime() >= rule.date.getTime();
    }
    if (rule.days != null) {
      const ageMs = now.getTime() - obj.createdAt.getTime();
      return ageMs >= rule.days * 24 * 60 * 60 * 1000;
    }
    return false;
  }
  ```
- Constants: `const BATCH_SIZE = 500;` and `const MAX_BATCHES_PER_TICK = 10;`.

## Acceptance criteria
- [ ] `ExpirationRule` matches §4.10 verbatim.
- [ ] `isExpired` returns true for a `rule.date` once `now.getTime() >= rule.date.getTime()`.
- [ ] `isExpired` returns true for a `rule.days` once `(now - obj.createdAt) >= rule.days * 24 * 60 * 60 * 1000`.
- [ ] `BATCH_SIZE === 500` and `MAX_BATCHES_PER_TICK === 10`.

## Test obligations
- Unit: covered by [TEST-0319]
- E2E: covered by [TEST-0320]
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.10 (lines 6347–6357, 6421–6436)
