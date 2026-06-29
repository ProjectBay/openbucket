---
id: TASK-1209
title: Implement AuthController.login with throttle and refresh cookie
story: STORY-0403
status: done
type: implementation
size: S
---

## Description
Add the `login` handler to `AuthController`, including the `@Public()` + `@UseGuards(ThrottlerGuard)` + `@Throttle({ login: { limit: 5, ttl: 60_000 } })` chain and the cookie setter helper.

## Files to create / modify
- `apps/backend/src/admin/auth/auth.controller.ts` — new (login handler + `setRefreshCookie` helper)

## Implementation notes
- Cookie attributes verbatim from §5.2.4 lines 7057–7064:
  ```ts
  res.cookie(REFRESH_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/admin/auth',
    expires: expiresAt,
  });
  ```
- `REFRESH_COOKIE = 'ob_refresh'`.
- Controller prefix: `@Controller('api/admin/auth')`.
- Audit emission verbatim: `this.audit.emit({ event: 'admin.login', subject: dto.username, ip: req.ip });`
- Decorator chain on the handler:
  ```ts
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  ```

## Acceptance criteria
- [ ] `POST /api/admin/auth/login` returns HTTP 200 with `{ accessToken, expiresIn }`.
- [ ] Sets `ob_refresh` cookie with the five required attributes (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/admin/auth`, `expires=refreshExpiresAt`).
- [ ] Sixth request from the same IP within 60s receives 429.
- [ ] Emits `admin.login` audit event.

## Test obligations
- Unit: N/A — covered via e2e
- E2E: covered by [TEST-0404]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1203], [TASK-1208], [TASK-1210]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7005–7019, 7057–7066)
