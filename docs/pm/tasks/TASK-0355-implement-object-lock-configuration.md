---
id: TASK-0355
title: Implement bucket object-lock configuration (GET/PUT ?object-lock)
story: STORY-0115
status: done
type: implementation
size: S
---

## Description
Implement bucket-scope object-lock configuration operations per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2532–2533):
  - `| GET  | `/:bucket` | `object-lock` | `GetObjectLockConfiguration` |`
  - `| PUT  | `/:bucket` | `object-lock` | `PutObjectLockConfiguration` |`
- `PutObjectLockConfiguration` is in `XML_REQUEST_OPS` (§2.3.2 line 1380).
- Body: `<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>GOVERNANCE|COMPLIANCE</Mode><Days>…</Days></DefaultRetention></Rule></ObjectLockConfiguration>`.
- Apply `@S3Operation('GetObjectLockConfiguration' | 'PutObjectLockConfiguration')`.

## Acceptance criteria
- [ ] PUT persists the configuration via `BucketService.setObjectLock(bucket, config)`.
- [ ] GET returns the persisted document.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0127]
- Conformance: covered by [TEST-0128]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2532–2533), §2.3.2 (line 1380)
