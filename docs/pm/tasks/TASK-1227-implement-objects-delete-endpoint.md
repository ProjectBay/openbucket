---
id: TASK-1227
title: Implement ObjectsAdminController.delete with audit
story: STORY-0410
status: done
type: implementation
size: XS
---

## Description
Implement `DELETE /api/admin/buckets/:name/objects/:key(*)`. Decodes key once, calls `ObjectService.delete`, emits `object.deleted` audit, returns 204.

## Files to create / modify
- `apps/backend/src/admin/objects/objects-admin.controller.ts` — modify (add `delete`)

## Implementation notes
- Verbatim from §5.6 (lines 7428–7444):
  ```ts
  @Delete(':key(*)')
  @HttpCode(204)
  async delete(@Param('name') bucket: string, @Param('key') key: string, @Req() req: Request): Promise<void> {
    const decoded = decodeURIComponent(key);
    await this.objects.delete(bucket, decoded);
    this.audit.emit({
      event: 'object.deleted',
      subject: (req as any).user.username,
      bucket, key: decoded,
      requestId: (req as any).requestId,
    });
  }
  ```

## Acceptance criteria
- [ ] Returns 204 on success.
- [ ] Audit event `object.deleted` with `subject`, `bucket`, `key` (decoded), `requestId`.
- [ ] Single-decode invariant preserved.

## Test obligations
- Unit: covered by [TEST-0412]
- E2E: covered by [TEST-0413]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1226], [STORY-0413]

## References
- `docs/WHITEPAPER.md` §5.6 (lines 7428–7448)
