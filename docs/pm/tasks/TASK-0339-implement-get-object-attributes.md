---
id: TASK-0339
title: Implement GetObjectAttributes
story: STORY-0109
status: done
type: implementation
size: S
---

## Description
Implement `GET /:bucket/:key+?attributes` (`GetObjectAttributes`).

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (GET family `'attributes' in q` branch)

## Implementation notes
- Route: `| GET  | `/:bucket/:key+` | `attributes` | `GetObjectAttributes` | |` (§2.8.3 line 2558).
- Apply `@S3Operation('GetObjectAttributes')`.
- Reads `x-amz-object-attributes` header (a comma-separated list of `ETag`, `Checksum`, `ObjectParts`, `StorageClass`, `ObjectSize`) and emits the requested subset as POJO `<GetObjectAttributesOutput>`.

## Acceptance criteria
- [ ] Requested attributes returned; unrequested ones omitted.
- [ ] `ObjectParts` lists the multipart part metadata when applicable.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2558)
