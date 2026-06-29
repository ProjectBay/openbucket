---
id: TASK-1230
title: Implement KeysAdminController.list
story: STORY-0411
status: done
type: implementation
size: XS
---

## Description
Implement `GET /api/admin/keys`. Returns an array of `KeySummaryDto`.

## Files to create / modify
- `apps/backend/src/admin/keys/keys-admin.controller.ts` — new (skeleton + `list`)

## Implementation notes
- Controller prefix `@Controller('api/admin/keys')`.
- Verbatim from §5.7 (lines 7475–7487):
  ```ts
  @Get()
  async list(): Promise<KeySummaryDto[]> {
    const rows = await this.keys.list();
    return rows.map((k) => ({
      id: k.id,
      accessKeyId: k.accessKeyId,
      label: k.label,
      role: k.role,                   // 'root' for v1
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      disabled: k.disabled,
    }));
  }
  ```

## Acceptance criteria
- [ ] Returns array of `KeySummaryDto`.
- [ ] `secretAccessKey` is never present in list responses.
- [ ] `role` is `'root'` in v1.

## Test obligations
- Unit: covered by [TEST-0414]
- E2E: covered by [TEST-0415]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1229]

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7475–7487)
