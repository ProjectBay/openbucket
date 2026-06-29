---
id: STORY-0404
title: Implement POST /api/admin/auth/refresh
epic: EPIC-05
status: done
size: S
risk: high
---

## User story
As an admin user, I want to POST to `/api/admin/auth/refresh` with the `ob_refresh` cookie and receive a new access token plus a rotated cookie, so that I can stay logged in across the 15-minute access-token lifetime without re-entering credentials.

## Description
Implement `AuthController.refresh` per §5.2.4. `@Public()` `@Post('refresh')` `@HttpCode(200)`. Reads `req.cookies?.[REFRESH_COOKIE]`; throws `UnauthorizedException('missing refresh')` if absent. Calls `AuthService.refresh(raw)` (which delegates to `RefreshTokenService.rotate`), sets the new cookie via `setRefreshCookie`, returns `{ accessToken, expiresIn }`. No audit emission for refresh (per §5.9 catalogue — refresh is implicit on every authenticated session).

## Acceptance criteria
- [x] Route is `POST /api/admin/auth/refresh`, public (no JWT required).
- [x] Missing cookie → 401 `missing refresh`.
- [x] Rotated/expired/reused refresh → 401 (with messages from `RefreshTokenService`).
- [x] Success → HTTP 200 with `{ accessToken, expiresIn }` and a fresh `ob_refresh` cookie whose value differs from the previous one.
- [x] Cookie attributes identical to login: `HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth`.

## Tasks
- [TASK-1211] Implement `AuthController.refresh` with cookie rotation

## Test plan
- [TEST-0405] Refresh endpoint e2e
- [TEST-0403] (shared) refresh-token rotation and reuse-revocation e2e

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0402], [STORY-0403]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7021–7033)
- Interfaces consumed: `AuthService.refresh` (STORY-0401), `RefreshTokenService.rotate` (STORY-0402)
