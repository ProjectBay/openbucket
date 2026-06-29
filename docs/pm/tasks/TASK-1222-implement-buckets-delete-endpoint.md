---
id: TASK-1222
title: Implement BucketsAdminController.delete with audit
story: STORY-0409
status: done
type: implementation
size: XS
---

## Description
Implement `DELETE /api/admin/buckets/:name`. Calls `BucketService.deleteByName` (which may throw `BucketNotEmpty`), emits `bucket.deleted` audit, returns 204.

## Files to create / modify
- `apps/backend/src/admin/buckets/buckets-admin.controller.ts` — modify (add `delete`)

## Implementation notes
- Verbatim from §5.5 (lines 7333–7346):
  ```ts
  @Delete(':name')
  @HttpCode(204)
  async delete(@Param('name') name: string, @Req() req: Request): Promise<void> {
    await this.buckets.deleteByName(name);   // throws BucketNotEmpty if non-empty
    this.audit.emit({
      event: 'bucket.deleted',
      subject: (req as any).user.username,
      bucket: name,
      requestId: (req as any).requestId,
    });
  }
  ```
- Add `@ApiOperation({ operationId: 'deleteBucket' })`.

## Acceptance criteria
- [ ] Returns 204 on success.
- [ ] Bucket-not-empty → 409 (exception filter maps from `BucketNotEmpty`).
- [ ] Audit event `bucket.deleted` emitted with `subject`, `bucket`, `requestId`.

## Test obligations
- Unit: covered by [TEST-0410]
- E2E: covered by [TEST-0411]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1221], [STORY-0413]

## References
- `docs/WHITEPAPER.md` §5.5 (lines 7333–7346)
