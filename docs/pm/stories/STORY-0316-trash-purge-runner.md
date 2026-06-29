---
id: STORY-0316
title: TrashPurgeRunner tick
epic: EPIC-04
status: done
size: S
risk: low
---

## User story
As an operator, I want trash entries whose grace period has expired to be permanently removed on a 5-minute tick, so that lifecycle-deleted blobs eventually free disk space.

## Description
Implement `apps/backend/src/common/background/trash-purge.runner.ts`. The runner scans `trash/` rows whose `expires_at < clock.now()`, then for each row unlinks the blob (via `BlobStore.deleteBlob` or direct `fs/promises.unlink` on the stored path), then deletes the trash row inside a transaction. Iteration yields with `setImmediate` between batches. Scheduled by `BackgroundService` every `5 * 60_000` ms. Errors on a single trash entry are logged and the loop continues.

## Acceptance criteria
- [ ] Runner uses `Clock.now()` (or `Clock.nowMs()`) to compute the "expired" predicate, not `Date.now()` directly.
- [ ] For each expired row the blob file is deleted before the SQLite row.
- [ ] Per-entry errors are caught and logged; the runner continues.
- [ ] Between batches, the runner awaits `new Promise((r) => setImmediate(r))`.
- [ ] `nx test backend --testPathPattern=trash-purge.runner.spec.ts` passes with TestClock.

## Tasks
- [TASK-0947] Implement TrashPurgeRunner skeleton with Clock injection
- [TASK-0948] Implement expired-entry enumeration and blob-then-row deletion
- [TASK-0949] Register TrashPurgeRunner in BackgroundModule

## Test plan
- [TEST-0322] TrashPurgeRunner unit tests with TestClock

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0313], [STORY-0318]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6205–6326)
- Interfaces consumed: `BlobStore.deleteBlob` (defined in [EPIC-03]), trash repository / `ObjectService` (defined in [EPIC-03]), `Clock.nowMs` (defined in [STORY-0318])
- Interfaces produced: `TrashPurgeRunner`
