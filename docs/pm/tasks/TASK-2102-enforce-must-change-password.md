---
id: TASK-2102
title: Enforce mustChangePassword server-side against a fresh DB read
story: STORY-0700
status: ready
type: implementation
size: M
---

## Description
Remediate audit finding [9] (low, CWE-620 Unverified Password Change — missing forced-rotation enforcement). `login()` issues a fully-privileged access token even when the user has `mustChangePassword = true`, and no guard restricts such a principal to the change-password endpoint — the claim is only echoed by `/me`. Worse, `refresh()` hardcodes `mustChangePassword: false`, so the advisory claim disappears from the token after the first refresh, defeating any claim-based check. Enforce the flag server-side against a fresh DB read so a principal in the forced-rotation state can only rotate their password (plus logout/me) until they do.

## Files to create / modify
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts` — modify: after a successful JWT verify and `req.user` attach (line 70 area), load the `AdminUser` row for `payload.sub`; if `user.mustChangePassword === true`, reject with 403 unless the resolved route is `POST /api/admin/settings/change-password`, `/api/admin/auth/logout`, or `/api/admin/auth/me`. Inject `AdminUserRepository`.
- `libs/nestjs/src/lib/admin/auth/auth.service.ts` — modify `refresh()` (line 62): re-derive `mustChangePassword` from the persisted `AdminUser` row instead of hardcoding `false`, so the claim cannot go stale/false across refreshes.
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.spec.ts` — modify/new: cases for a `mustChangePassword` principal being 403'd on a normal route and allowed on change-password.

## Implementation notes
- Root cause: `auth.service.ts:54` signs a full-privilege token regardless of the flag; `JwtAuthGuard` (`jwt-auth.guard.ts:44-75`) only checks signature/issuer/audience and never reads `mustChangePassword`; the flag is signed in (`issueTokens`, `auth.service.ts:79-83`) and echoed by `/me` but enforced nowhere.
- `refresh()` bug to fix (`auth.service.ts:57-66`):
  ```ts
  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    const rotated = await this.refreshTokens.rotate(rawRefreshToken);
    return this.issueTokens(rotated.subjectId, rotated.username, false, /* ← hardcoded */ ...);
  }
  ```
  Replace the hardcoded `false` with the persisted flag, e.g. read `await this.users.findByUsername(rotated.username)` and pass `user?.mustChangePassword ?? false`.
- Base the guard decision on a FRESH DB read of the `AdminUser` row (not the JWT claim), because the claim goes stale once the password is rotated and because the pre-fix `refresh()` could otherwise mint a `false` claim. `AdminUserRepository.findByUsername` (`admin-user.repository.ts:18`) provides the row; `mustChangePassword` defaults to `false` on the entity (`admin-user.entity.ts:24`).
- Allowlist the exact escape routes so the principal can actually recover: `POST /api/admin/settings/change-password` (clears the flag at `settings-admin.controller.ts:40`), plus `/api/admin/auth/logout` and `/api/admin/auth/me`. Everything else → `ForbiddenException` (403).
- The amplifying bootstrap scenario (plaintext `TEMP-ADMIN-PASSWORD` log line, `admin-bootstrap.service.ts:66`) only fires in dev/test branch 2 where `ADMIN_PASSWORD_HASH` is absent; production requires the env hash (branch 1, `mustChangePassword: false`). The enforcement gap itself is unconditional, which is what this task closes.
- CWE: CWE-620. Verdict CONFIRMED.

## Acceptance criteria
- [ ] A bearer token for a principal whose persisted `AdminUser.mustChangePassword` is `true` returns 403 on `GET /api/admin/buckets` (and any non-allowlisted admin route).
- [ ] The same token succeeds on `POST /api/admin/settings/change-password`, `/api/admin/auth/logout`, and `/api/admin/auth/me`.
- [ ] After the password is changed (flag cleared), the principal can access all admin routes normally.
- [ ] `refresh()` produces an access token whose `mustChangePassword` claim matches the persisted row (not hardcoded `false`).
- [ ] `nx test nestjs --testPathPattern=jwt-auth.guard.spec.ts` passes with the enforcement cases.

## Test obligations
- Unit: `jwt-auth.guard.spec.ts` — forced-rotation principal is 403'd off normal routes, allowed on change-password/logout/me; enforcement reads the DB, not the claim.
- E2E: covered by [TEST-0700] (cases 6–7).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2100] (land the P0 first), [STORY-0407] (`JwtAuthGuard`), [STORY-0401]/[STORY-0404] (`AuthService.refresh`), [STORY-0412] (change-password + bootstrap).

## References
- Audit finding [9] (low, CWE-620).
- `docs/WHITEPAPER.md` §5.2.2 (login/refresh), §5.3 (`JwtAuthGuard`), §5.8 (bootstrap / change-password).
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts:44-75`; `libs/nestjs/src/lib/admin/auth/auth.service.ts:54,57-66,79-83`; `libs/nestjs/src/lib/persistence/repositories/admin-user.repository.ts:18`; `libs/nestjs/src/lib/persistence/entities/admin-user.entity.ts:24`; `libs/nestjs/src/lib/admin/bootstrap/admin-bootstrap.service.ts:60,66`.
