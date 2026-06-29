---
id: TASK-1220
title: Implement BucketsAdminController.create with audit emission
story: STORY-0409
status: done
type: implementation
size: S
---

## Description
Implement `POST /api/admin/buckets`. Validates `CreateBucketDto`, calls `BucketService.create`, emits `bucket.created` audit event, returns HTTP 201 with `BucketSummaryDto` (object count and size both zero on create).

## Files to create / modify
- `apps/backend/src/admin/buckets/buckets-admin.controller.ts` — modify (add `create`)

## Implementation notes
- Verbatim from §5.5 (lines 7290–7316):
  ```ts
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateBucketDto, @Req() req: Request): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.create({
      name: dto.name,
      versioning: dto.versioning,
      objectLock: dto.objectLock,
      region: dto.region,
    });
    this.audit.emit({
      event: 'bucket.created',
      subject: (req as any).user.username,
      bucket: bucket.name,
      requestId: (req as any).requestId,
    });
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock,
      objectCount: 0,
      sizeBytes: 0,
    };
  }
  ```
- Add `@ApiOperation({ operationId: 'createBucket' })`.

## Acceptance criteria
- [ ] Returns 201 with `BucketSummaryDto`.
- [ ] Audit event `bucket.created` emitted with `subject`, `bucket`, `requestId`.
- [ ] Invalid name → 422 (via global ZodValidationPipe).

## Test obligations
- Unit: covered by [TEST-0410]
- E2E: covered by [TEST-0411]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1216], [TASK-1217], [TASK-1219], [STORY-0413]

## References
- `docs/WHITEPAPER.md` §5.5 (lines 7290–7316)
