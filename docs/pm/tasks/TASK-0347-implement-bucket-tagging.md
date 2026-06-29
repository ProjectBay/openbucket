---
id: TASK-0347
title: Implement bucket tagging (GET/PUT/DELETE ?tagging)
story: STORY-0111
status: done
type: implementation
size: S
---

## Description
Implement the three bucket-tagging operations per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2526–2528):
  - `| GET  | `/:bucket` | `tagging` | `GetBucketTagging` |`
  - `| PUT  | `/:bucket` | `tagging` | `PutBucketTagging` |`
  - `| DELETE | `/:bucket` | `tagging` | `DeleteBucketTagging` |`
- `PutBucketTagging` is in `XML_REQUEST_OPS` (§2.3.2 line 1374) — body `<Tagging><TagSet><Tag><Key/><Value/></Tag>…</TagSet></Tagging>`.
- Apply `@S3Operation('GetBucketTagging' | 'PutBucketTagging' | 'DeleteBucketTagging')`.
- GET with no tags → `NoSuchTagSetError`.

## Acceptance criteria
- [ ] PUT persists `<Tagging>` document; GET returns the same.
- [ ] DELETE clears tags and returns 204.
- [ ] Missing → 404 `NoSuchTagSet`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0119]
- Conformance: covered by [TEST-0120]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2526–2528), §2.3.2 (line 1374)
