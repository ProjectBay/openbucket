---
id: STORY-0403
title: Implement POST /api/admin/auth/login with refresh cookie
epic: EPIC-05
status: done
size: S
risk: medium
---

## User story
As an admin user, I want to POST credentials to `/api/admin/auth/login` and receive a JWT plus an HttpOnly refresh cookie, so that the SPA can hold the access token in memory while the browser handles refresh.

## Description
Implement `AuthController.login` per §5.2.4 with `@Public()`, `@UseGuards(ThrottlerGuard)`, `@Throttle({ login: { limit: 5, ttl: 60_000 } })`, `@Post('login')`, `@HttpCode(200)`. Body is `LoginDto`; the handler calls `AuthService.login`, calls `setRefreshCookie` (HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth; expires=refreshExpiresAt; cookie name `ob_refresh`), emits `admin.login` audit event with `subject` and `ip`, and returns `{ accessToken, expiresIn }` as `LoginResponseDto`.

## Acceptance criteria
- [x] Route is `POST /api/admin/auth/login` mounted under controller prefix `'api/admin/auth'`.
- [x] Handler is annotated `@Public()`, throttled at `5/min` via named login throttler.
- [x] Success returns HTTP 200 with body `{ accessToken: string, expiresIn: number }`.
- [x] Success sets cookie `ob_refresh` with attributes `httpOnly: true; secure: true; sameSite: 'strict'; path: '/api/admin/auth'; expires: refreshExpiresAt`.
- [x] Invalid credentials → 401 with body `{ message: 'invalid credentials', ... }`; constant-time path covered by AuthService.
- [x] Audit event `admin.login` is emitted with `subject: dto.username, ip: req.ip`.
- [x] `LoginDto` and `LoginResponseDto` are nestjs-zod DTOs (created in [STORY-0408] dependency or co-located here).

## Tasks
- [TASK-1208] Implement `LoginDto` and `LoginResponseDto`
- [TASK-1209] Implement `AuthController.login` with throttle + cookie
- [TASK-1210] Implement `@Public()` metadata decorator

## Test plan
- [TEST-0404] Login endpoint e2e

## Dependencies
- Blocks: [STORY-0404], [STORY-0406]
- Blocked by: [STORY-0401]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 6979–7077)
- Interfaces produced: `AuthController` (login), `LoginDto`, `LoginResponseDto`, `@Public()`
