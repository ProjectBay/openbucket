---
id: TASK-0043
title: Wire app.close() and process.exit semantics
story: STORY-0015
status: done
type: implementation
size: XS
---

## Description
After the drain race, `await app.close()` so MikroORM's `onApplicationShutdown` hook fires, then `process.exit(outcome === 'timeout' ? 1 : 0)`. Catch errors from `app.close()` and log via `logger.error({ err }, 'Error during app.close().')` then exit with code 1.

## Files to create / modify
- `apps/openbucket-backend/src/bootstrap/shutdown.ts` — modify

## Implementation notes
- Quote §1.10 (lines 1034–1042) verbatim:
  ```ts
  try {
    await app.close();
    logger.log('Nest application closed cleanly.');
    process.exit(outcome === 'timeout' ? 1 : 0);
  } catch (err) {
    logger.error({ err }, 'Error during app.close().');
    process.exit(1);
  }
  ```
- §1.10 closing paragraph (lines 1049–1051): "MikroORM cleanup is triggered by `app.close()` via the `MikroOrmModule`'s `onApplicationShutdown` hook — no explicit call is needed in this file."

## Acceptance criteria
- [ ] `await app.close()` is the last cleanup call before `process.exit`.
- [ ] On clean drain, `process.exit(0)`.
- [ ] On drain timeout, `process.exit(1)` with the documented warning emitted before exit.
- [ ] `app.close()` throw paths are caught and exit with code 1 after `'Error during app.close().'` log.

## Test obligations
- Unit: covered by [TEST-0016]
- E2E: covered by [TEST-0017]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0042]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 1034–1051)
