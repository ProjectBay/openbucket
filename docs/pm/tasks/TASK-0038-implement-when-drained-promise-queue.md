---
id: TASK-0038
title: Implement whenDrained promise queue semantics
story: STORY-0014
status: done
type: implementation
size: XS
---

## Description
Verify and add unit-test coverage for the `whenDrained()` queue semantics per §1.10: when the counter is zero, the promise resolves synchronously (`Promise.resolve()`); otherwise the resolver is added to the `drained` set and fired by the next `leave()` that brings the counter to zero.

## Files to create / modify
- `apps/openbucket-backend/src/common/shutdown-state.service.ts` — modify (no behavior change; this Task is the design-by-contract polish)

## Implementation notes
- Quote §1.10 (lines 961–964):
  ```ts
  whenDrained(): Promise<void> {
    if (this._inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.drained.add(resolve));
  }
  ```
- The `drained` set is cleared at the moment of fanout, so callers awaiting `whenDrained()` after a fanout begin a fresh queue.

## Acceptance criteria
- [ ] With `_inFlight === 0`, `whenDrained()` returns a pre-resolved promise.
- [ ] With `_inFlight > 0`, multiple concurrent `whenDrained()` awaits all resolve when the counter next hits zero.
- [ ] After fanout, the `drained` set is empty.

## Test obligations
- Unit: covered by [TEST-0015]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0037]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 961–965)
