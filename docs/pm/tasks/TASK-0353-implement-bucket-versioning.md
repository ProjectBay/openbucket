---
id: TASK-0353
title: Implement bucket versioning (GET/PUT ?versioning)
story: STORY-0113
status: done
type: implementation
size: S
---

## Description
Implement bucket versioning operations per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2521–2522):
  - `| GET  | `/:bucket` | `versioning` | `GetBucketVersioning` |`
  - `| PUT  | `/:bucket` | `versioning` | `PutBucketVersioning` | Enable / Suspend. |`
- `PutBucketVersioning` is in `XML_REQUEST_OPS` (§2.3.2 line 1373).
- Body: `<VersioningConfiguration><Status>Enabled|Suspended</Status><MfaDelete>…</MfaDelete></VersioningConfiguration>`.
- Apply `@S3Operation('GetBucketVersioning' | 'PutBucketVersioning')`.
- `MfaDelete` is accepted and ignored (single-tenant root-only).

## Acceptance criteria
- [ ] PUT `Status: Enabled` and `Status: Suspended` persisted via `BucketService.setVersioning(bucket, status)`.
- [ ] GET returns the current status (empty `<VersioningConfiguration/>` if never set).

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0123]
- Conformance: covered by [TEST-0124]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2521–2522), §2.3.2 (line 1373)
