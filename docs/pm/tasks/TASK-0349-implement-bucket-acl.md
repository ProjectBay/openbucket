---
id: TASK-0349
title: Implement bucket ACL (GET/PUT ?acl)
story: STORY-0111
status: done
type: implementation
size: S
---

## Description
Implement bucket ACL operations per §2.8.2 — single-tenant means GET always returns owner-full and PUT is a no-op.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2513–2514):
  - `| GET  | `/:bucket` | `acl` | `GetBucketAcl` | Single-tenant: always returns owner-full. |`
  - `| PUT  | `/:bucket` | `acl` | `PutBucketAcl` | Accepted; no-op beyond owner-full. |`
- `PutBucketAcl` is in `XML_REQUEST_OPS` (§2.3.2 line 1377).
- Apply `@S3Operation('GetBucketAcl' | 'PutBucketAcl')`.
- GET returns POJO `<AccessControlPolicy>` with one `<Grant>` granting `FULL_CONTROL` to the owner.

## Acceptance criteria
- [ ] GET returns owner-full ACL regardless of stored state.
- [ ] PUT accepts the document and returns 200 without persisting differences.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0119]
- Conformance: covered by [TEST-0120]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2513–2514), §2.3.2 (line 1377)
