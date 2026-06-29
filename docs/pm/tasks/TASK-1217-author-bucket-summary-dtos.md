---
id: TASK-1217
title: Author BucketSummaryDto and ListBucketsResponseDto
story: STORY-0408
status: done
type: implementation
size: XS
---

## Description
Author the two response DTOs for bucket listing.

## Files to create / modify
- `apps/backend/src/admin/buckets/dto/bucket-summary.dto.ts` — new
- `apps/backend/src/admin/buckets/dto/list-buckets-response.dto.ts` — new

## Implementation notes
- `BucketSummarySchema` verbatim from §5.4.2 (lines 7200–7207):
  ```ts
  export const BucketSummarySchema = z.object({
    name: z.string(),
    createdAt: z.string().datetime(),
    versioning: z.enum(['disabled', 'enabled', 'suspended']),
    objectLock: z.boolean(),
    objectCount: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
  });
  ```
- `ListBucketsResponseSchema` verbatim from §5.4.2 (lines 7219–7222):
  ```ts
  export const ListBucketsResponseSchema = z.object({
    buckets: z.array(BucketSummarySchema),
    total: z.number().int().nonnegative(),
  });
  ```
- Both flow into OpenAPI → Angular models — no hand-written interfaces on the frontend.

## Acceptance criteria
- [ ] Both DTOs extend `createZodDto`.
- [ ] `versioning` enum includes `'suspended'` (response) — distinct from `CreateBucketSchema.versioning` which lacks it.
- [ ] `createdAt` is `string().datetime()`.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0411]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.4.2 (lines 7193–7227)
