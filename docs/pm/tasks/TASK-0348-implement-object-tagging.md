---
id: TASK-0348
title: Implement object tagging (GET/PUT/DELETE ?tagging)
story: STORY-0111
status: done
type: implementation
size: S
---

## Description
Implement the three object-tagging operations per §2.8.3.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PUT/GET/DELETE families, `'tagging' in q` branch)

## Implementation notes
- Routes (§2.8.3 lines 2553–2555):
  - `| GET  | `/:bucket/:key+` | `tagging` | `GetObjectTagging` |`
  - `| PUT  | `/:bucket/:key+` | `tagging` | `PutObjectTagging` |`
  - `| DELETE | `/:bucket/:key+` | `tagging` | `DeleteObjectTagging` |`
- Per §2.1.1 (lines 1170, 1187, 1227): branches `if ('tagging' in q) return this.objects.{put,get,delete}Tagging(req, bucket, key);`.
- `PutObjectTagging` is in `XML_REQUEST_OPS` (§2.3.2 line 1381).
- Apply `@S3Operation('GetObjectTagging' | 'PutObjectTagging' | 'DeleteObjectTagging')`.

## Acceptance criteria
- [ ] PUT body `<Tagging><TagSet><Tag><Key/><Value/></Tag>…</TagSet></Tagging>` persisted.
- [ ] GET returns the same; DELETE clears.
- [ ] Missing key → `NoSuchKey`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0119]
- Conformance: covered by [TEST-0120]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0102], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.3 (lines 2553–2555), §2.1.1 (lines 1170, 1187, 1227), §2.3.2 (line 1381)
