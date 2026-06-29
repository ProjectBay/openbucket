---
id: STORY-0405
title: Implement POST /api/admin/auth/logout
epic: EPIC-05
status: done
size: XS
risk: low
---

## User story
As an admin user, I want to POST to `/api/admin/auth/logout` and have my refresh token revoked and cookie cleared, so that the session is terminated server-side.

## Description
Implement `AuthController.logout` per §5.2.4. `@Post('logout')` `@HttpCode(204)`. Reads `req.cookies?.[REFRESH_COOKIE]`; calls `AuthService.logout(raw)` (which revokes if defined), clears the cookie via `res.clearCookie('ob_refresh', { path: '/api/admin/auth' })`, and emits audit event `admin.logout` with `subject` resolved from `req.user?.username ?? 'unknown'`. Not `@Public()` — the bearer token is required so we know which subject is logging out.

## Acceptance criteria
- [x] Route is `POST /api/admin/auth/logout`, requires JWT (not `@Public()`).
- [x] Returns HTTP 204 with no body.
- [x] Calls `res.clearCookie('ob_refresh', { path: '/api/admin/auth' })`.
- [x] Audit event `admin.logout` emitted with `subject = req.user?.username ?? 'unknown'`.
- [x] Idempotent: calling logout twice or without a cookie still returns 204 (after auth).

## Tasks
- [TASK-1212] Implement `AuthController.logout`

## Test plan
- [TEST-0406] Logout endpoint e2e

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0401], [STORY-0407]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7035–7045)
