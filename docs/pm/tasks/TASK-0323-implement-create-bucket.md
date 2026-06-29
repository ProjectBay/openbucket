---
id: TASK-0323
title: Implement CreateBucket
story: STORY-0108
status: done
type: implementation
size: S
---

## Description
Implement `PUT /:bucket` (`CreateBucket`) per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| PUT  | `/:bucket` | — | `CreateBucket` | Body optional; `<CreateBucketConfiguration>` if region declared. |` (§2.8.2 line 2505).
- Branch fires when no bucket-scope query flag is present.
- `XmlInterceptor` parses optional `<CreateBucketConfiguration>` body (op is in `XML_REQUEST_OPS`).
- Calls `BucketService.create(bucket, locationConstraint?)` from EPIC-03. Conflict → `BucketAlreadyOwnedByYou` (single-tenant) per §2.6.

## Acceptance criteria
- [ ] Empty body accepted.
- [ ] `<CreateBucketConfiguration><LocationConstraint>us-east-1</LocationConstraint></CreateBucketConfiguration>` accepted.
- [ ] Duplicate bucket → `BucketAlreadyOwnedByYouError`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2505)
