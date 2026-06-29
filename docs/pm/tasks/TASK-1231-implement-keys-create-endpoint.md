---
id: TASK-1231
title: Implement KeysAdminController.create with one-time secret
story: STORY-0411
status: done
type: implementation
size: S
---

## Description
Implement `POST /api/admin/keys`. Creates a new access key with `role: 'root'` (v1 hard-code), emits `key.created` audit, and returns `CreatedKeyDto` containing the plaintext `secretAccessKey` exactly once. The secret is never persisted in plaintext and never returned by any other endpoint.

## Files to create / modify
- `apps/backend/src/admin/keys/keys-admin.controller.ts` — modify (add `create`)

## Implementation notes
- Verbatim from §5.7 (lines 7489–7512):
  ```ts
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateKeyDto, @Req() req: Request): Promise<CreatedKeyDto> {
    const created = await this.keys.create({ label: dto.label, role: 'root' });
    this.audit.emit({
      event: 'key.created',
      subject: (req as any).user.username,
      keyId: created.id,
      requestId: (req as any).requestId,
    });
    // SECURITY: secretAccessKey is returned ONCE. Never persisted in plaintext;
    // never returned again on any other endpoint.
    return {
      id: created.id,
      accessKeyId: created.accessKeyId,
      secretAccessKey: created.secretAccessKey,
      label: created.label,
      role: created.role,
      createdAt: created.createdAt.toISOString(),
    };
  }
  ```

## Acceptance criteria
- [ ] Returns HTTP 201 with `CreatedKeyDto` containing `secretAccessKey`.
- [ ] Audit event `key.created` emitted with `subject`, `keyId`, `requestId`.
- [ ] No persisted plaintext: backing `KeyService.create` stores secret as hash only (EPIC-03 invariant).
- [ ] Subsequent `GET /api/admin/keys/...` calls never expose the secret.

## Test obligations
- Unit: covered by [TEST-0414]
- E2E: covered by [TEST-0415]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1229], [TASK-1230], [STORY-0413]

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7489–7512)
