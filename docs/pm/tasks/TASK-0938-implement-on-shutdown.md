---
id: TASK-0938
title: Implement onApplicationShutdown to clear intervals and await in-flight ticks
story: STORY-0313
status: done
type: implementation
size: XS
---

## Description
Implement `onApplicationShutdown` to set `shuttingDown = true`, `clearInterval` for every tick, and `await Promise.allSettled(this.ticks.map(t => t.inFlight ?? Promise.resolve()))`.

## Files to create / modify
- `apps/backend/src/common/background/background.service.ts` — modify

## Implementation notes
- Verbatim per §4.9:
  ```ts
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const t of this.ticks) {
      if (t.handle) clearInterval(t.handle);
      t.handle = undefined;
    }
    await Promise.allSettled(this.ticks.map((t) => t.inFlight ?? Promise.resolve()));
  }
  ```
- Quote §4.9: "Caller (shutdown hook) bounds total time; we don't bound here." — the bound is enforced by `ShutdownService` ([STORY-0319]).
- Method must be safe to call twice (re-entrancy from `ShutdownService` is intentional).

## Acceptance criteria
- [ ] `shuttingDown` is true after the first call.
- [ ] All `setInterval` handles are cleared.
- [ ] `Promise.allSettled` resolves when every in-flight tick settles.
- [ ] Calling twice is a no-op the second time.

## Test obligations
- Unit: covered by [TEST-0318]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0937]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6263–6272)
