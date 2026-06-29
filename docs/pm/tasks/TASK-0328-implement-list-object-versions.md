---
id: TASK-0328
title: Implement ListObjectVersions
story: STORY-0108
status: done
type: implementation
size: S
---

## Description
Implement `GET /:bucket?versions` (`ListObjectVersions`).

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| GET  | `/:bucket` | `versions` | `ListObjectVersions` | |` (§2.8.2 line 2510).
- Returns POJO with `__root: 'ListVersionsResult'` and `<Version>` + `<DeleteMarker>` entries.
- Reads `prefix`, `key-marker`, `version-id-marker`, `delimiter`, `max-keys` query params.

## Acceptance criteria
- [ ] Versioned buckets return all versions including delete markers.
- [ ] Unversioned buckets return only the current version.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2510)
