---
id: TASK-0959
title: Implement step 2 — stream drain with 30s deadline and forced destroy
story: STORY-0319
status: done
type: implementation
size: S
---

## Description
After step 1, poll `activeSockets.size > 0` every 100 ms until the set is empty or `STREAM_DRAIN_DEADLINE_MS = 30_000` ms have elapsed. On deadline, call `socket.destroy()` on each remaining socket and log the count.

## Files to create / modify
- `apps/backend/src/common/shutdown/shutdown.service.ts` — modify

## Implementation notes
- Verbatim per §4.12:
  ```ts
  const drainStart = Date.now();
  while (this.activeSockets.size > 0) {
    if (Date.now() - drainStart >= STREAM_DRAIN_DEADLINE_MS) {
      this.log.warn(
        `Drain deadline reached with ${this.activeSockets.size} sockets — destroying`,
      );
      for (const sock of this.activeSockets) {
        sock.destroy();
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  this.log.log(`Stream drain complete in ${Date.now() - drainStart}ms`);
  ```

## Acceptance criteria
- [ ] Drain loop polls at 100 ms cadence.
- [ ] On 30s deadline, each remaining socket is `destroy()`'d and a warn log is emitted.
- [ ] Final log includes elapsed milliseconds.

## Test obligations
- Unit: covered by [TEST-0326]
- E2E: covered by [TEST-0327]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0958]

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6611–6625)
