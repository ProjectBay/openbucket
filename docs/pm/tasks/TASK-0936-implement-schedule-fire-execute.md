---
id: TASK-0936
title: Implement schedule/fire/execute with no-pile-up guard and RequestContext wrap
story: STORY-0313
status: done
type: implementation
size: S
---

## Description
Implement `private schedule(name, intervalMs, runner)`, `private fire(tick)`, and `private async execute(tick)`. `fire` skips if `tick.inFlight` is set; `execute` wraps `tick.runner()` in `RequestContext.create(this.orm.em, async () => { await tick.runner(); })` and logs a pile-up warning when the run exceeds 80% of the interval.

## Files to create / modify
- `apps/backend/src/common/background/background.service.ts` — modify

## Implementation notes
- `schedule` verbatim per §4.9:
  ```ts
  private schedule(name: string, intervalMs: number, runner: () => Promise<void>): void {
    const tick: TickHandle = { name, intervalMs, runner };
    tick.handle = setInterval(() => this.fire(tick), intervalMs);
    tick.handle.unref();
    this.ticks.push(tick);
  }
  ```
- `fire` verbatim per §4.9:
  ```ts
  private fire(tick: TickHandle): void {
    if (this.shuttingDown) return;
    if (tick.inFlight) {
      this.log.debug(`Skipping ${tick.name}: previous tick still running`);
      return;
    }
    tick.inFlight = this.execute(tick).finally(() => {
      tick.inFlight = undefined;
    });
  }
  ```
- `execute` verbatim per §4.9:
  ```ts
  private async execute(tick: TickHandle): Promise<void> {
    const started = Date.now();
    try {
      await RequestContext.create(this.orm.em, async () => {
        await tick.runner();
      });
    } catch (err) {
      this.log.error(`Tick ${tick.name} failed`, err as Error);
    } finally {
      const ms = Date.now() - started;
      if (ms > tick.intervalMs * 0.8) {
        this.log.warn(`Tick ${tick.name} took ${ms}ms (interval ${tick.intervalMs}ms) — risk of pile-up`);
      }
    }
  }
  ```

## Acceptance criteria
- [ ] `setInterval` handle is `.unref()`'d.
- [ ] `fire` skips when `inFlight` is set (debug log).
- [ ] `execute` wraps in `RequestContext.create(this.orm.em, ...)`.
- [ ] Pile-up warning fires when `ms > intervalMs * 0.8`.

## Test obligations
- Unit: covered by [TEST-0318]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0935]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6274–6316)
