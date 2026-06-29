---
id: TASK-1221
title: Implement BucketsAdminController.get
story: STORY-0409
status: done
type: implementation
size: XS
---

## Description
Implement `GET /api/admin/buckets/:name`. Looks up the bucket, throws 404 if missing, otherwise returns `BucketSummaryDto` with stats from `ObjectService.statsFor`.

## Files to create / modify
- `apps/backend/src/admin/buckets/buckets-admin.controller.ts` — modify (add `get`)

## Implementation notes
- Verbatim from §5.5 (lines 7318–7331):
  ```ts
  @Get(':name')
  async get(@Param('name') name: string): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.findByName(name);
    if (!bucket) throw new NotFoundException(`bucket ${name} not found`);
    const stats = await this.objects.statsFor(name);
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock,
      objectCount: stats.objectCount,
      sizeBytes: stats.sizeBytes,
    };
  }
  ```
- Add `@ApiOperation({ operationId: 'getBucket' })`.

## Acceptance criteria
- [ ] 200 with `BucketSummaryDto` on hit.
- [ ] 404 (`'bucket <name> not found'`) on miss.

## Test obligations
- Unit: covered by [TEST-0410]
- E2E: covered by [TEST-0411]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1219]

## References
- `docs/WHITEPAPER.md` §5.5 (lines 7318–7331)
