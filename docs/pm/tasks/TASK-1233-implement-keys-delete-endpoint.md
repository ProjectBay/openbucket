---
id: TASK-1233
title: Implement KeysAdminController.delete
story: STORY-0411
status: done
type: implementation
size: XS
---

## Description
Implement `DELETE /api/admin/keys/:id`. Returns 204, emits `key.deleted` audit.

## Files to create / modify
- `apps/backend/src/admin/keys/keys-admin.controller.ts` — modify (add `delete`)

## Implementation notes
- Verbatim from §5.7 (lines 7539–7549):
  ```ts
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.keys.delete(id);
    this.audit.emit({
      event: 'key.deleted',
      subject: (req as any).user.username,
      keyId: id,
      requestId: (req as any).requestId,
    });
  }
  ```

## Acceptance criteria
- [ ] Returns 204.
- [ ] Audit event `key.deleted` emitted.

## Test obligations
- Unit: covered by [TEST-0414]
- E2E: covered by [TEST-0415]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1232], [STORY-0413]

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7539–7549)
