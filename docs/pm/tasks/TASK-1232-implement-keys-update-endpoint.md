---
id: TASK-1232
title: Implement KeysAdminController.update with conditional audit
story: STORY-0411
status: done
type: implementation
size: S
---

## Description
Implement `PATCH /api/admin/keys/:id`. Validates `UpdateKeyDto`, calls `KeyService.update`, returns `KeySummaryDto` or 404, emits `key.disabled` audit when `dto.disabled === true`, otherwise `key.updated`.

## Files to create / modify
- `apps/backend/src/admin/keys/keys-admin.controller.ts` — modify (add `update`)

## Implementation notes
- Verbatim from §5.7 (lines 7514–7537):
  ```ts
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateKeyDto, @Req() req: Request): Promise<KeySummaryDto> {
    const updated = await this.keys.update(id, { disabled: dto.disabled, label: dto.label });
    if (!updated) throw new NotFoundException();
    this.audit.emit({
      event: dto.disabled === true ? 'key.disabled' : 'key.updated',
      subject: (req as any).user.username,
      keyId: id,
      requestId: (req as any).requestId,
    });
    return {
      id: updated.id,
      accessKeyId: updated.accessKeyId,
      label: updated.label,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      disabled: updated.disabled,
    };
  }
  ```

## Acceptance criteria
- [ ] Returns 200 `KeySummaryDto` on hit, 404 on miss.
- [ ] Empty body (no `label`, no `disabled`) → 422 via `.refine`.
- [ ] Audit event is `key.disabled` only when `dto.disabled === true`; otherwise `key.updated`.

## Test obligations
- Unit: covered by [TEST-0414]
- E2E: covered by [TEST-0415]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1231]

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7514–7537)
