---
id: TASK-0037
title: Implement ShutdownState service
story: STORY-0014
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/common/shutdown-state.service.ts` per §1.10. Expose `isShuttingDown`, `inFlight`, `abortController`, `beginShutdown()`, `enter()`, `leave()`, `whenDrained()` with the semantics described in §1.10.

## Files to create / modify
- `apps/openbucket-backend/src/common/shutdown-state.service.ts` — new

## Implementation notes
- Quote §1.10 (lines 932–965) verbatim:
  ```ts
  @Injectable()
  export class ShutdownState {
    private _isShuttingDown = false;
    private _inFlight = 0;
    private readonly drained = new Set<() => void>();
    /** AbortSignal background workers observe; aborted when shutdown begins. */
    readonly abortController = new AbortController();

    get isShuttingDown(): boolean { return this._isShuttingDown; }
    get inFlight(): number        { return this._inFlight; }

    beginShutdown(): void {
      if (this._isShuttingDown) return;
      this._isShuttingDown = true;
      this.abortController.abort();
    }

    enter(): void { this._inFlight += 1; }
    leave(): void {
      this._inFlight = Math.max(0, this._inFlight - 1);
      if (this._inFlight === 0) {
        for (const resolve of this.drained) resolve();
        this.drained.clear();
      }
    }

    whenDrained(): Promise<void> {
      if (this._inFlight === 0) return Promise.resolve();
      return new Promise((resolve) => this.drained.add(resolve));
    }
  }
  ```
- §1.10 line 940 calls out the `abortController` is the shutdown signal that EPIC-04 background workers observe.

## Acceptance criteria
- [ ] File matches the verbatim quote.
- [ ] `beginShutdown()` is idempotent.
- [ ] `leave()` floors `_inFlight` at zero and resolves all queued drain callbacks when reaching zero.

## Test obligations
- Unit: covered by [TEST-0015]
- E2E: N/A — observable e2e via STORY-0015
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 932–965)
