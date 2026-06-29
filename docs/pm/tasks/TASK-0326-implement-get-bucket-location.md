---
id: TASK-0326
title: Implement GetBucketLocation
story: STORY-0108
status: done
type: implementation
size: XS
---

## Description
Implement `GET /:bucket?location` (`GetBucketLocation`).

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| GET  | `/:bucket` | `location` | `GetBucketLocation` | Returns `us-east-1`. |` (§2.8.2 line 2512).
- Returns POJO `{ __root: 'LocationConstraint', '#text': 'us-east-1' }` (or per `XmlSerializer`'s convention).

## Acceptance criteria
- [ ] Body equals `<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2512)
