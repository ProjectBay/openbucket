---
id: TASK-0960
title: Implement step 3 — explicit BackgroundService.onApplicationShutdown
story: STORY-0319
status: done
type: implementation
size: XS
---

## Description
After the stream drain, call `await this.background.onApplicationShutdown()` directly. Although Nest also invokes it via the shutdown-hook chain, calling it explicitly here pins the ordering (post-drain, pre-BlobStore-close). The `BackgroundService` guards on `shuttingDown` so re-entry is safe.

## Files to create / modify
- `apps/backend/src/common/shutdown/shutdown.service.ts` — modify

## Implementation notes
- Verbatim per §4.12:
  ```ts
  // (3) Cancel scheduler ticks and await the in-flight tick.
  await this.background.onApplicationShutdown();
  this.log.log('Background ticks cancelled and drained');
  ```
- Quote §4.12: "Re-entrancy is safe — the service guards on `shuttingDown`."

## Acceptance criteria
- [ ] `background.onApplicationShutdown()` is awaited before any subsequent step.
- [ ] Log `Background ticks cancelled and drained` is emitted.

## Test obligations
- Unit: covered by [TEST-0326]
- E2E: covered by [TEST-0327]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0959]

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6627–6633)
