---
id: TASK-0302
title: Implement BucketController dispatcher
story: STORY-0100
status: done
type: implementation
size: M
---

## Description
Implement the BucketController with the same fan-out pattern as ObjectController but switching on the bucket-scope query flags listed in §2.8.2. Exposes `DELETE /:bucket` and `POST /:bucket?delete` for bulk delete.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify (implement)

## Implementation notes
- Apply `@UseGuards(SigV4Guard) @UseFilters(S3ExceptionFilter) @UseInterceptors(XmlInterceptor)` decorators (per §2.1.1 lines 1144–1148).
- Per §2.1 lines 1233–1235: "structured identically but switches on the bucket-scope query flags (`?versioning`, `?cors`, `?lifecycle`, etc.) and exposes `DELETE /:bucket` plus `POST /:bucket?delete` for bulk delete."
- Dispatch matrix derived from §2.8.2 (lines 2503–2540): for each verb, branch on the presence of `versioning`, `cors`, `lifecycle`, `tagging`, `policy`, `encryption`, `object-lock`, `acl`, `replication`, `notification`, `accelerate`, `logging`, `requestPayment`, `website`, `location`, `versions`, `uploads`, `list-type=2`, `delete`.
- The `@S3Operation('<Name>', {...})` decorator (TASK-0305) marks each branch.

## Acceptance criteria
- [ ] Every row in §2.8.2 has a matching dispatch branch.
- [ ] `req.openbucket.operation` is populated for every matched route.
- [ ] Unknown bucket-scope query combinations fall through to `ListObjectsV1` (the legacy default) per §2.8.2 line 2508.

## Test obligations
- Unit: covered by [TEST-0100]
- E2E: covered transitively by [TEST-0113], [TEST-0121], [TEST-0123], [TEST-0125], [TEST-0127], [TEST-0129]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300], [TASK-0305], [TASK-0307], [STORY-0102], [STORY-0103], [STORY-0106]

## References
- `docs/WHITEPAPER.md` §2.1 (lines 1233–1240), §2.8.2 (lines 2501–2540)
