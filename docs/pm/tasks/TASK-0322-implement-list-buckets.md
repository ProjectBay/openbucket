---
id: TASK-0322
title: Implement ListBuckets handler
story: STORY-0107
status: done
type: implementation
size: XS
---

## Description
Implement the `ListBuckets` handler invoked from `ServiceController.get()`. Returns POJO with `__root: 'ListAllMyBucketsResult'`.

## Files to create / modify
- `apps/backend/src/s3/controllers/service.controller.ts` — modify

## Implementation notes
- Per §2.8.1 (line 2499): `| GET | `/` | — | `ListBuckets` | Returns `<ListAllMyBucketsResult>`. Root creds only in v1. |`
- Delegate to `BucketService.listBuckets()` from EPIC-03; map rows to `{ Buckets: { Bucket: rows.map(r => ({ Name: r.name, CreationDate: r.createdAt.toISOString() })) }, Owner: { ID, DisplayName } }`.
- Apply `@S3Operation('ListBuckets')` (from TASK-0305) before the handler.

## Acceptance criteria
- [ ] `GET /` with valid SigV4 returns 200 and `<ListAllMyBucketsResult>` containing `<Buckets>` and `<Owner>`.
- [ ] Single-tenant: only the root credentials authorize (per §2.8.1 notes).

## Test obligations
- Unit: N/A — covered transitively
- E2E: covered by [TEST-0111]
- Conformance: covered by [TEST-0112]

## Dependencies
- Blocked by: [TASK-0303], [STORY-0103], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.1 (lines 2495–2499)
