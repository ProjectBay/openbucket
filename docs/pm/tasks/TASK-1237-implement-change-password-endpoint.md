---
id: TASK-1237
title: Implement SettingsAdminController.changePassword
story: STORY-0412
status: done
type: implementation
size: S
---

## Description
Implement `POST /api/admin/settings/change-password`. Verifies `currentPassword` via argon2, hashes new password with argon2id, updates the user row with `mustChangePassword: false`, emits `admin.password.changed` audit. Returns 204.

## Files to create / modify
- `apps/backend/src/admin/settings/settings-admin.controller.ts` — new

## Implementation notes
- Verbatim from §5.8 (lines 7654–7692):
  ```ts
  @Controller('api/admin/settings')
  export class SettingsAdminController {
    constructor(
      private readonly users: AdminUserRepository,
      private readonly audit: AuditService,
    ) {}

    @Post('change-password')
    @HttpCode(204)
    async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request): Promise<void> {
      const subject = (req as any).user as { sub: string; username: string };
      const user = await this.users.findById(subject.sub);
      if (!user) throw new UnauthorizedException();

      const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
      if (!ok) throw new UnauthorizedException('current password incorrect');

      const newHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
      await this.users.update(user.id, { passwordHash: newHash, mustChangePassword: false });

      this.audit.emit({
        event: 'admin.password.changed',
        subject: user.username,
        requestId: (req as any).requestId,
      });
    }
  }
  ```
- `mustChangePassword` is advisory at v1 — the JWT claim drives SPA redirect; API-level enforcement is deferred (the user can only mutate their own password before rotating).

## Acceptance criteria
- [ ] Wrong current password → 401 `'current password incorrect'`.
- [ ] Missing user (claim mismatch) → 401 (no message).
- [ ] On success: user row has new argon2id hash and `mustChangePassword: false`.
- [ ] Audit event `admin.password.changed` emitted.
- [ ] Returns HTTP 204.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0417]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1236], [STORY-0413]

## References
- `docs/WHITEPAPER.md` §5.8 (lines 7651–7695)
