---
id: TASK-0338
title: Implement RestoreObject stub
story: STORY-0109
status: done
type: implementation
size: XS
---

## Description
Implement `POST /:bucket/:key+?restore` (`RestoreObject`) as a stub returning 200 OK.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (POST family `'restore' in q` branch)

## Implementation notes
- Route: `| POST | `/:bucket/:key+` | `restore` | `RestoreObject` | Stub: 200 OK. |` (§2.8.3 line 2552).
- Per §2.1.1 (line 1213): `if ('restore' in q) return this.objects.restoreObject(req, bucket, key);`.
- Apply `@S3Operation('RestoreObject')`. Body is `<RestoreRequest>` XML — accepted, parsed, ignored.

## Acceptance criteria
- [ ] Returns 200 OK with empty body.
- [ ] Does not error on valid `<RestoreRequest>` body.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2552), §2.1.1 (line 1213)
