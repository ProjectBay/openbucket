---
id: TASK-0623
title: Implement `BlobStore.headBlob` (stat-only, ENOENT → null)
story: STORY-0208
status: done
type: implementation
size: XS
---

## Description
Return size + mtime for an on-disk blob, or `null` if it does not exist — so HEAD callers don't need to catch.

## Files to create / modify
- `apps/openbucket-backend/src/storage/blob-store.ts` — modify (add method)

## Implementation notes
- Signature (verbatim from §3.6.3): `async headBlob(bucket: string, key: string): Promise<HeadResult | null>`.
- Body (verbatim from §3.6.2):
  ```ts
  try {
    const stat = await fs.stat(this.paths.blobPath(bucket, key));
    return { size: BigInt(stat.size), mtime: stat.mtime };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  ```
- All other `fs.stat` errors (`EACCES`, `EIO`) are rethrown.

## Acceptance criteria
- [ ] `headBlob('b', 'present')` returns `{ size: <bigint>, mtime: Date }` with `size` matching the file's byte count.
- [ ] `headBlob('b', 'missing')` returns `null` — no exception.
- [ ] A simulated permission error is rethrown.

## Test obligations
- Unit: covered by [TEST-0208]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0620]

## References
- `docs/WHITEPAPER.md` §3.6.2 (lines 4318–4330), §3.6.3 (lines 4471–4479)
