---
id: TASK-1219
title: Implement BucketsAdminController.list
story: STORY-0409
status: done
type: implementation
size: S
---

## Description
Implement `GET /api/admin/buckets`: call `BucketService.listWithStats()` and shape the result to `ListBucketsResponseDto`.

## Files to create / modify
- `apps/backend/src/admin/buckets/buckets-admin.controller.ts` — new (skeleton + `list`)

## Implementation notes
- Controller prefix `@Controller('api/admin/buckets')`.
- Verbatim from §5.5 (lines 7274–7288):
  ```ts
  @Get()
  async list(): Promise<ListBucketsResponseDto> {
    const items = await this.buckets.listWithStats();
    return {
      buckets: items.map((b) => ({
        name: b.name,
        createdAt: b.createdAt.toISOString(),
        versioning: b.versioning,
        objectLock: b.objectLock,
        objectCount: b.stats.objectCount,
        sizeBytes: b.stats.sizeBytes,
      })),
      total: items.length,
    };
  }
  ```
- Add `@ApiOperation({ operationId: 'listBuckets' })` so the generated client method name is `listBuckets()` (see §5.13).

## Acceptance criteria
- [ ] Returns `{ buckets: [...], total: <count> }` shape.
- [ ] `createdAt` is ISO-8601.
- [ ] No business rules inline.

## Test obligations
- Unit: covered by [TEST-0410]
- E2E: covered by [TEST-0411]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1217], [STORY-0407]

## References
- `docs/WHITEPAPER.md` §5.5 (lines 7274–7288)
