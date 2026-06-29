---
id: TASK-0324
title: Implement DeleteBucket
story: STORY-0108
status: done
type: implementation
size: XS
---

## Description
Implement `DELETE /:bucket` (`DeleteBucket`).

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| DELETE | `/:bucket` | — | `DeleteBucket` | Refuses if non-empty (`BucketNotEmpty`). |` (§2.8.2 line 2506).
- Calls `BucketService.delete(bucket)`; on non-empty → throw `BucketNotEmptyError`.
- Returns 204 on success.

## Acceptance criteria
- [ ] Empty bucket → 204.
- [ ] Non-empty bucket → 409 `BucketNotEmpty`.
- [ ] Unknown bucket → 404 `NoSuchBucket`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2506)
