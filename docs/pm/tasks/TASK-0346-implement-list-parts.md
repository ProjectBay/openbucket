---
id: TASK-0346
title: Implement ListParts route
story: STORY-0110
status: done
type: implementation
size: S
---

## Description
Implement `GET /:bucket/:key+?uploadId=…` (`ListParts`) per §2.8.4.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (GET family uploadId branch)

## Implementation notes
- Route: `| GET  | `/:bucket/:key+` | `uploadId=…` | `ListParts` | |` (§2.8.4 line 2574).
- Per §2.1.1 (lines 1191–1193): `if (q.uploadId !== undefined) { return this.multipart.listParts(req, bucket, key, q.uploadId); }`.
- Apply `@S3Operation('ListParts')`.
- Reads `part-number-marker`, `max-parts` query params.
- Returns POJO `{ __root: 'ListPartsResult', Bucket, Key, UploadId, PartNumberMarker, NextPartNumberMarker, MaxParts, IsTruncated, Part: rows.map(...) }`.

## Acceptance criteria
- [ ] Default `max-parts` 1000.
- [ ] `IsTruncated` set when more parts remain.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0117]
- Conformance: covered by [TEST-0118]

## Dependencies
- Blocked by: [TASK-0301], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.4 (line 2574), §2.1.1 (lines 1191–1193)
