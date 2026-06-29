---
id: TASK-0961
title: Implement steps 4 and 5 — BlobStore.close and orm.close(true)
story: STORY-0319
status: done
type: implementation
size: XS
---

## Description
After cancelling background ticks, call `await this.blobs.close?.()` (optional — BlobStore may not pool fds), then `await this.orm.close(true)` which checkpoints WAL on better-sqlite3. Log a final `Shutdown complete` line.

## Files to create / modify
- `apps/backend/src/common/shutdown/shutdown.service.ts` — modify

## Implementation notes
- Verbatim per §4.12:
  ```ts
  // (4) Close BlobStore handles (any open write streams it pooled).
  await this.blobs.close?.();
  this.log.log('BlobStore closed');

  // (5) Close MikroORM (also checkpoints WAL on better-sqlite3).
  await this.orm.close(true);
  this.log.log('MikroORM closed');

  this.log.log('Shutdown complete');
  ```
- Quote §4.12: "Closing here triggers a WAL checkpoint, leaving the DB file in a clean state for the next boot."

## Acceptance criteria
- [ ] `blobs.close?.()` is invoked via optional-chain (no error if absent).
- [ ] `orm.close(true)` is awaited with the `true` argument.
- [ ] Final log `Shutdown complete` is emitted.

## Test obligations
- Unit: covered by [TEST-0326]
- E2E: covered by [TEST-0327]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0960]

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6635–6644, 6655–6656)
