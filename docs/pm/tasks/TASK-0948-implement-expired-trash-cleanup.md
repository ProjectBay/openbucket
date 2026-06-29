---
id: TASK-0948
title: Implement expired-entry enumeration and blob-then-row deletion
story: STORY-0316
status: done
type: implementation
size: S
---

## Description
Implement `TrashPurgeRunner.run`: enumerate trash rows where `expires_at < clock.now()`, then for each row delete the blob via `BlobStore.deleteBlob` (or direct `unlink`), then delete the trash row. Use a per-entry try/catch and yield between batches with `setImmediate`.

## Files to create / modify
- `apps/backend/src/common/background/trash-purge.runner.ts` — modify

## Implementation notes
- Pseudocode aligned with §4.9's description and §4.10's batching pattern:
  ```ts
  const now = this.clock.now();
  const batch = await this.trashRepo.findExpired(now, BATCH_SIZE);
  for (const entry of batch) {
    try {
      await this.blobs.deleteBlob({ bucket: entry.bucket, key: entry.key, versionId: entry.versionId });
      await this.trashRepo.remove(entry);
    } catch (err) {
      this.log.error(`Trash purge failed for ${entry.bucket}/${entry.key}`, err as Error);
    }
  }
  await new Promise((r) => setImmediate(r));
  ```
- The exact repository surface is owned by EPIC-03; this Task should consume whatever names EPIC-03 declares.

## Acceptance criteria
- [ ] Each expired entry has its blob deleted before its row.
- [ ] Per-entry errors are logged and the loop continues.
- [ ] `await new Promise((r) => setImmediate(r))` runs between batches.

## Test obligations
- Unit: covered by [TEST-0322]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0947]

## References
- `docs/WHITEPAPER.md` §4.9 (line 6444), §4.10 (line 6412)
