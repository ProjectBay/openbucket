---
id: TASK-0937
title: Implement onApplicationBootstrap with runOnce orphan scan + scheduled ticks
story: STORY-0313
status: done
type: implementation
size: XS
---

## Description
Implement `onApplicationBootstrap` to call `runOnce('orphan-scan', () => this.orphans.run())` first, then schedule the three recurring ticks with the §4.9 intervals.

## Files to create / modify
- `apps/backend/src/common/background/background.service.ts` — modify

## Implementation notes
- Verbatim per §4.9:
  ```ts
  async onApplicationBootstrap(): Promise<void> {
    await this.runOnce('orphan-scan', () => this.orphans.run());

    this.schedule('lifecycle-sweep', 60_000, () => this.lifecycle.run());
    this.schedule('multipart-cleanup', 5 * 60_000, () => this.multipart.run());
    this.schedule('trash-purge', 5 * 60_000, () => this.trash.run());
  }

  private async runOnce(name: string, runner: () => Promise<void>): Promise<void> {
    try {
      await RequestContext.create(this.orm.em, async () => runner());
    } catch (err) {
      this.log.error(`One-shot ${name} failed`, err as Error);
    }
  }
  ```
- Quote §4.9: "One-shot scans run *before* the recurring ticks start, so they can't race with a lifecycle sweep that might delete the orphans they log."

## Acceptance criteria
- [ ] `orphan-scan` is awaited before the three `schedule` calls.
- [ ] Recurring intervals are exactly `60_000`, `5 * 60_000`, `5 * 60_000`.

## Test obligations
- Unit: covered by [TEST-0318]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0936]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6253–6261, 6318–6324)
