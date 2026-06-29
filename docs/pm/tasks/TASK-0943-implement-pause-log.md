---
id: TASK-0943
title: Wire MAX_BATCHES_PER_TICK pause log
story: STORY-0314
status: done
type: implementation
size: XS
---

## Description
After the per-rule loop exits, if `batches === MAX_BATCHES_PER_TICK` (i.e., the loop hit the per-tick cap before exhausting the rule's objects), emit a log line so operators can see paused sweeps.

## Files to create / modify
- `apps/backend/src/common/background/lifecycle-sweep.runner.ts` — modify

## Implementation notes
- Verbatim per §4.10:
  ```ts
  if (batches === MAX_BATCHES_PER_TICK) {
    this.log.log(`Rule ${rule.ruleId} paused at cursor ${cursor}; resumes next tick`);
  }
  ```

## Acceptance criteria
- [ ] When the loop reaches `MAX_BATCHES_PER_TICK`, the pause log is emitted exactly once per rule per tick.
- [ ] When the loop exits via empty page, no pause log is emitted.

## Test obligations
- Unit: covered by [TEST-0319]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0941]

## References
- `docs/WHITEPAPER.md` §4.10 (lines 6415–6417)
