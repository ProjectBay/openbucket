---
id: TASK-0331
title: Implement DeleteObjects (POST ?delete bulk)
story: STORY-0108
status: done
type: implementation
size: S
---

## Description
Implement `POST /:bucket?delete` (`DeleteObjects`) per §2.8.2 line 2540 — bulk delete with an XML `<Delete>` body.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| POST | `/:bucket` | `delete` | `DeleteObjects` | Bulk delete; XML body `<Delete>`. |` (§2.8.2 line 2540).
- `DeleteObjects` is in `XML_REQUEST_OPS` (§2.3.2 line 1384) — `XmlInterceptor` parses the `<Delete>` body.
- Iterates `<Object><Key>…</Key><VersionId>…</VersionId></Object>` entries; calls `ObjectService.deleteObject(bucket, key, versionId?)` for each; returns POJO `<DeleteResult>` with `<Deleted>` + `<Error>` arrays.
- Honours `<Quiet>true</Quiet>` flag (skips `<Deleted>` entries on success).

## Acceptance criteria
- [ ] Body up to 1000 `<Object>` entries accepted.
- [ ] Each entry produces either a `<Deleted>` or `<Error>` element in the response.
- [ ] `<Quiet>` mode suppresses `<Deleted>` on success.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2540), §2.3.2 (line 1384)
