---
id: TASK-2101
title: Revoke all refresh tokens for the subject on password change
story: STORY-0700
status: ready
type: implementation
size: S
---

## Description
Remediate audit finding [3] (medium, CWE-613 Insufficient Session Expiration). `SettingsAdminController.changePassword` updates the password hash but never revokes outstanding refresh tokens, and access tokens are stateless — so the canonical account-recovery action (changing the password after suspecting compromise) does not evict an attacker who already holds a stolen `ob_refresh` cookie. The attacker keeps calling `/api/admin/auth/refresh`, rotating to a fresh 7-day token indefinitely. Add a subject-wide refresh-token revocation and call it on password change.

## Files to create / modify
- `libs/nestjs/src/lib/persistence/repositories/refresh-token.repository.ts` — new method `revokeAllForSubject(subjectId, at)` that revokes every non-revoked row for the subject (the entity is already indexed on `subjectId` via `ix_refresh_subject`).
- `libs/nestjs/src/lib/admin/auth/refresh-token.service.ts` — new method `revokeAllForSubject(subjectId)` delegating to the repository, using the injected `Clock` for the timestamp.
- `libs/nestjs/src/lib/admin/settings/settings-admin.controller.ts` — modify `changePassword` (line 40 area): after the hash update, call `refreshTokens.revokeAllForSubject(user.username)` and emit an `admin.sessions.revoked` audit event. Inject `RefreshTokenService` into the controller.
- `libs/nestjs/src/lib/admin/settings/settings-admin.module.ts` — modify: ensure `RefreshTokenService` is available to the controller (import the auth module / provider as needed).

## Implementation notes
- The subject id is the username (the `AdminUser` primary key, also the JWT `sub`); `RefreshToken.subjectId` stores it (`refresh-token.entity.ts:29`).
- Repository method (mirrors the existing `revoke` / `revokeDescendants` `nativeUpdate` style):
  ```ts
  async revokeAllForSubject(subjectId: string, at: Date): Promise<void> {
    await this.getEntityManager().nativeUpdate(
      RefreshToken,
      { subjectId, revokedAt: null },
      { revokedAt: at },
    );
  }
  ```
- Service wrapper:
  ```ts
  async revokeAllForSubject(subjectId: string): Promise<void> {
    await this.repo.revokeAllForSubject(subjectId, this.clock.now());
  }
  ```
- In `changePassword`, insert the call right after the existing update (`settings-admin.controller.ts:40`):
  ```ts
  await this.users.update(user.username, { passwordHash: newHash, mustChangePassword: false });
  await this.refreshTokens.revokeAllForSubject(user.username);
  ```
  Once revoked, `RefreshTokenService.rotate` rejects the stolen token at its `if (row.revokedAt) throw new UnauthorizedException('revoked')` gate (`refresh-token.service.ts:74`).
- Stateless 15-minute access JWTs cannot be revoked this way; a `tokenVersion`/`passwordChangedAt` claim checked at verification time is the durable follow-up but is OUT OF SCOPE for this task (tracked separately). This task closes the 7-day refresh-token window, which is the reachable persistence vector.
- CWE: CWE-613. Verdict CONFIRMED.

## Acceptance criteria
- [ ] After a successful change-password, replaying the pre-change `ob_refresh` value at `POST /api/admin/auth/refresh` returns 401 `revoked`.
- [ ] A fresh login after the change still succeeds and can refresh normally (the new chain is unaffected).
- [ ] `RefreshTokenRepository.revokeAllForSubject` sets `revokedAt` only on rows whose `revokedAt` is currently null and matching `subjectId`.
- [ ] An `admin.sessions.revoked` audit event is emitted with `subject` and `requestId`.
- [ ] `nx test nestjs --testPathPattern=refresh-token` passes with the new revocation cases.

## Test obligations
- Unit: `refresh-token.service` / repository spec — `revokeAllForSubject` revokes all live rows for a subject and leaves other subjects untouched.
- E2E: covered by [TEST-0700] (case 5).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2100] (land the P0 first), [STORY-0402] (`RefreshTokenService`/repository), [STORY-0412] (`changePassword`), [STORY-0413] (`AuditService`).

## References
- Audit finding [3] (medium, CWE-613).
- `docs/WHITEPAPER.md` §5.2.3 (refresh-token lifecycle), §5.8 (change-password).
- `libs/nestjs/src/lib/admin/settings/settings-admin.controller.ts:40`; `libs/nestjs/src/lib/admin/auth/refresh-token.service.ts:69,74,95`; `libs/nestjs/src/lib/persistence/repositories/refresh-token.repository.ts`; `libs/nestjs/src/lib/persistence/entities/refresh-token.entity.ts:13,29,50`.
