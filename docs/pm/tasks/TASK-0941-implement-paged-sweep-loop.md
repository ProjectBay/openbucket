---
id: TASK-0941
title: Implement paged sweep loop with cursor save and setImmediate yield
story: STORY-0314
status: done
type: implementation
size: S
---

## Description
Implement `run()` on `LifecycleSweepRunner`. For each rule, load the cursor via `LifecycleService.loadCursor(ruleId)`, page `ObjectService.scanForLifecycle({ bucket, prefix, afterKey: cursor, limit: BATCH_SIZE })`, save the cursor after each non-empty batch, and `await new Promise((r) => setImmediate(r))` between batches.

## Files to create / modify
- `apps/backend/src/common/background/lifecycle-sweep.runner.ts` — modify

## Implementation notes
- Verbatim per §4.10:
  ```ts
  async run(): Promise<void> {
    const rules = await this.lifecycle.activeExpirationRules();
    const now = new Date(this.clock.nowMs());

    for (const rule of rules) {
      let batches = 0;
      let cursor = await this.lifecycle.loadCursor(rule.ruleId);

      while (batches < MAX_BATCHES_PER_TICK) {
        const page = await this.objects.scanForLifecycle({
          bucket: rule.bucket,
          prefix: rule.prefix,
          afterKey: cursor,
          limit: BATCH_SIZE,
        });

        if (page.length === 0) {
          await this.lifecycle.saveCursor(rule.ruleId, null);
          break;
        }

        // ... batch handling in [TASK-0942] ...

        cursor = page[page.length - 1].key;
        await this.lifecycle.saveCursor(rule.ruleId, cursor);
        batches++;

        await new Promise((r) => setImmediate(r));
      }

      if (batches === MAX_BATCHES_PER_TICK) {
        this.log.log(`Rule ${rule.ruleId} paused at cursor ${cursor}; resumes next tick`);
      }
    }
  }
  ```

## Acceptance criteria
- [ ] For each rule, `loadCursor` is called once at the start of the loop.
- [ ] After each non-empty batch, `saveCursor(rule.ruleId, page[page.length-1].key)` is called.
- [ ] Empty page → `saveCursor(rule.ruleId, null)` then `break`.
- [ ] Between batches, `await new Promise((r) => setImmediate(r))` is awaited.
- [ ] Reaching `MAX_BATCHES_PER_TICK` logs `Rule <ruleId> paused at cursor <cursor>; resumes next tick`.

## Test obligations
- Unit: covered by [TEST-0319]
- E2E: covered by [TEST-0320]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0940]

## References
- `docs/WHITEPAPER.md` §4.10 (lines 6370–6417)
