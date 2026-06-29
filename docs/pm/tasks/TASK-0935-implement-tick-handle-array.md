---
id: TASK-0935
title: Implement TickHandle interface and ticks[] array
story: STORY-0313
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/background/background.service.ts` and define the `TickHandle` interface plus the `ticks: TickHandle[]` field on the service. Include the `shuttingDown: boolean` flag.

## Files to create / modify
- `apps/backend/src/common/background/background.service.ts` — new

## Implementation notes
- Verbatim per §4.9:
  ```ts
  interface TickHandle {
    readonly name: string;
    readonly intervalMs: number;
    readonly runner: () => Promise<void>;
    handle?: NodeJS.Timeout;
    inFlight?: Promise<void>;
  }
  ```
- Service properties:
  ```ts
  private readonly log = new Logger(BackgroundService.name);
  private readonly ticks: TickHandle[] = [];
  private shuttingDown = false;
  ```

## Acceptance criteria
- [ ] `TickHandle` interface matches §4.9 verbatim.
- [ ] `ticks` and `shuttingDown` private fields exist.

## Test obligations
- Unit: covered by [TEST-0318]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6231–6244)
