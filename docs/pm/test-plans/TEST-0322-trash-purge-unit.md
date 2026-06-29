---
id: TEST-0322
title: TrashPurgeRunner unit tests with TestClock
covers: [STORY-0316, TASK-0947, TASK-0948, TASK-0949]
status: done
level: unit
---

## Goal
Verify the trash purge tick processes entries whose `expires_at < clock.now()`, deletes the blob before the row, tolerates per-entry errors, and yields between batches.

## Setup
- Mock trash repository / `ObjectService`, `BlobStore.deleteBlob`, `Clock` (TestClock).

## Cases
1. Given three entries with `expires_at` `[past, past, future]`, then only the two past entries are processed.
2. For each processed entry, `BlobStore.deleteBlob` is called BEFORE the trash row is removed.
3. Given `BlobStore.deleteBlob` throws for one entry, then the loop logs and continues.
4. Between batches, `await new Promise((r) => setImmediate(r))` is observed.
5. After `clock.advance(...)`, an entry that was future becomes past on the next run.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=trash-purge.runner.spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §4.9 (line 6444)
