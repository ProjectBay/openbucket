---
id: TASK-0636
title: Implement `VersionStoreService.listVersions`
story: STORY-0213
status: done
type: implementation
size: S
---

## Description
Implement the paginated list of `ObjectVersion` rows backing the S3 `ListObjectVersions` operation. Delegates to the same predicate shape as `ObjectRepository.listVersionsByPrefix`, ordered newest-first per key.

## Files to create / modify
- `apps/openbucket-backend/src/storage/version-store.service.ts` — modify (add method)

## Implementation notes
- Signature (verbatim from §3.11.2): `async listVersions(bucket: string, prefix: string, keyMarker: string | undefined, versionMarker: string | undefined, limit: number): Promise<ObjectVersion[]>`.
- Body (verbatim from §3.11.2):
  ```ts
  return this.em.getRepository(ObjectVersion).find(
    {
      bucket: { name: bucket },
      ...(prefix ? { key: { $like: `${prefix}%` } } : {}),
      ...(keyMarker
        ? versionMarker
          ? {
              $or: [
                { key: { $gt: keyMarker } },
                { $and: [{ key: keyMarker }, { versionId: { $gt: versionMarker } }] },
              ],
            }
          : { key: { $gt: keyMarker } }
        : {}),
    },
    { orderBy: { key: 'ASC', createdAt: 'DESC' }, limit: limit + 1 },
  );
  ```
- Per §3.11.2 docstring: "Implemented via `ObjectRepository.listVersionsByPrefix` — see §3.4.2. Repeated here for the interface contract; the repo is the entry point." Reuse the repo where convenient, but the service signature must remain stable.
- Per §3.4.2 (repo cousin): the upper bound is computed via `nextStringBound(prefix)`; the inline service version uses `$like` because it's the contract-stub path. The repo path remains preferred for performance.

## Acceptance criteria
- [ ] `listVersions(bucket, '', undefined, undefined, 100)` returns all versions across all keys in the bucket, ordered `key ASC, createdAt DESC`.
- [ ] `listVersions(bucket, 'photos/', undefined, undefined, 50)` restricts to keys with that prefix.
- [ ] Pagination: passing `keyMarker = 'k1'` returns only rows with `key > 'k1'`; passing both `keyMarker` and `versionMarker` returns the `$or` window described above.
- [ ] The method fetches `limit + 1` rows (truncation detection happens in the caller).

## Test obligations
- Unit: covered by [TEST-0213]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0606], [TASK-0617], [TASK-0634]

## References
- `docs/WHITEPAPER.md` §3.11.2 (lines 5058–5088)
