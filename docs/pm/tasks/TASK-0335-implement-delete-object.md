---
id: TASK-0335
title: Implement DeleteObject route
story: STORY-0109
status: done
type: implementation
size: XS
---

## Description
Implement `DELETE /:bucket/:key+` (`DeleteObject`) per §2.8.3.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (DELETE family)

## Implementation notes
- Route: `| DELETE | `/:bucket/:key+` | — | `DeleteObject` | Optional `versionId` query. |` (§2.8.3 line 2550).
- Per §2.1.1 (lines 1221–1229) — terminal branch after all sub-query tests.
- Reads optional `?versionId=…`; calls `ObjectService.deleteObject(bucket, key, versionId?)`.
- Returns 204; for versioned buckets, sets `x-amz-version-id` and `x-amz-delete-marker: true` when a delete marker is created.

## Acceptance criteria
- [ ] 204 on success.
- [ ] `x-amz-delete-marker: true` and `x-amz-version-id` headers on versioned bucket.
- [ ] Missing key on unversioned bucket → 204 (S3 idempotent semantics).

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2550), §2.1.1 (lines 1219–1229)
