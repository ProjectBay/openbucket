---
id: STORY-0700
title: Admin authentication & session hardening
epic: EPIC-08
status: ready
size: M
risk: high
---

## User story
As an operator exposing OpenBucket to a hostile network, I want the admin API to be fail-closed — no request can reach a privileged admin handler without a valid, current bearer token, and rotating a credential actually evicts existing sessions — so that an anonymous or stale-credential caller cannot download whole-instance backups, mint S3 keys, or persist after a password change.

## Description
Close the three admin-auth findings of the 2026-07-04 white-box audit. Finding [1] (CRITICAL, CWE-178/CWE-289) is an unauthenticated admin-API bypass: `JwtAuthGuard` gates auth on a case-sensitive path prefix (`jwt-auth.guard.ts:51`) while Express routes case-insensitively, so `GET /api/Admin/backup` reaches the real handler with `req.user` never set and no token checked. Finding [3] (medium, CWE-613) is that `changePassword` never revokes outstanding refresh tokens, so a stolen `ob_refresh` cookie survives the victim's password reset. Finding [9] (low, CWE-620) is that `mustChangePassword` is advisory-only — no guard restricts a principal in the forced-rotation state, and `refresh()` even hardcodes the claim to `false`. This Story makes the guard fail-closed, revokes sessions on password change, and enforces `mustChangePassword` server-side against a fresh DB read.

## Acceptance criteria
- [ ] A request to any mixed-case admin path (`GET /api/Admin/backup`, `/api/ADMIN/buckets`, `/API/ADMIN/keys`) without a bearer token returns 401, not 200.
- [ ] `RequestClassifierMiddleware` classifies the same mixed-case paths as `kind: 'admin'` so classification agrees with routing.
- [ ] After a successful `POST /api/admin/settings/change-password`, every previously issued refresh token for that subject is revoked: a prior `ob_refresh` value replayed at `/api/admin/auth/refresh` returns 401.
- [ ] An access token whose principal has `mustChangePassword = true` (verified by a fresh DB read) is rejected with 403 on every admin route except `POST /api/admin/settings/change-password`, `/api/admin/auth/logout`, and `/api/admin/auth/me`.
- [ ] `refresh()` re-derives `mustChangePassword` from the persisted `AdminUser` row instead of hardcoding `false`.
- [ ] A `admin.sessions.revoked` audit event is emitted when password change revokes sessions.

## Tasks
- [TASK-2100] Fix admin-guard case-sensitivity auth bypass (fail-closed)
- [TASK-2101] Revoke all refresh tokens for the subject on password change
- [TASK-2102] Enforce mustChangePassword server-side against a fresh DB read

## Test plan
- [TEST-0700] Admin auth-bypass and session-revocation e2e

## Dependencies
- Blocks: [STORY-0701], [STORY-0702] (all downstream hardening assumes the admin surface is actually authenticated)
- Blocked by: _none_ — remediation of existing code ([STORY-0407] `JwtAuthGuard`, [STORY-0402] refresh-token rotation, [STORY-0412] change-password already exist).
- **[TASK-2100] is the critical P0 and must land first, as a standalone patch release**, ahead of [TASK-2101]/[TASK-2102] and the rest of EPIC-08.

## References
- White-box security audit 2026-07-04, findings [1] (CRITICAL, CWE-178/CWE-289), [3] (medium, CWE-613), [9] (low, CWE-620).
- `docs/WHITEPAPER.md` §5.2 (admin auth), §5.3 (`JwtAuthGuard`), §5.8 (change-password / bootstrap).
- Source under remediation: `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts:51`, `libs/nestjs/src/lib/common/middleware/request-classifier.middleware.ts:45`, `libs/nestjs/src/lib/admin/settings/settings-admin.controller.ts:40`, `libs/nestjs/src/lib/admin/auth/auth.service.ts:54`, `refresh()` at `auth.service.ts:62`, `libs/nestjs/src/lib/admin/auth/refresh-token.service.ts`, `libs/nestjs/src/lib/persistence/repositories/refresh-token.repository.ts`, `apps/openbucket-backend/src/main.ts`.
- Interfaces consumed: `JwtAuthGuard`, `RefreshTokenService`, `RefreshTokenRepository`, `AdminUserRepository`, `AuditService`.
- Interfaces produced: `RefreshTokenService.revokeAllForSubject`, `RefreshTokenRepository.revokeAllForSubject`, fresh-DB-read `mustChangePassword` enforcement in `JwtAuthGuard`.
