---
id: TASK-0350
title: Implement object ACL (GET/PUT ?acl)
story: STORY-0111
status: done
type: implementation
size: S
---

## Description
Implement object ACL operations per §2.8.3 — accepted but no-op.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PUT/GET families, `'acl' in q` branch)

## Implementation notes
- Routes (§2.8.3 lines 2556–2557):
  - `| GET  | `/:bucket/:key+` | `acl` | `GetObjectAcl` |`
  - `| PUT  | `/:bucket/:key+` | `acl` | `PutObjectAcl` | Accepted; no-op. |`
- Per §2.1.1 (lines 1171, 1188): branches `if ('acl' in q) return this.objects.{put,get}Acl(req, bucket, key);`.
- Apply `@S3Operation('GetObjectAcl' | 'PutObjectAcl')`.

## Acceptance criteria
- [ ] GET returns the same owner-full document used at bucket scope.
- [ ] PUT accepts and returns 200; never errors on a well-formed body.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0119]
- Conformance: covered by [TEST-0120]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0102]

## References
- `docs/WHITEPAPER.md` §2.8.3 (lines 2556–2557), §2.1.1 (lines 1171, 1188)
