---
id: TASK-1212
title: Implement AuthController.logout
story: STORY-0405
status: done
type: implementation
size: XS
---

## Description
Add the `logout` handler to `AuthController`. Reads `req.cookies?.[REFRESH_COOKIE]`, calls `AuthService.logout(raw)`, clears the cookie, and emits `admin.logout` audit event.

## Files to create / modify
- `apps/backend/src/admin/auth/auth.controller.ts` — modify (add `logout` method)

## Implementation notes
- Verbatim from §5.2.4 lines 7035–7045:
  ```ts
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/admin/auth' });
    this.audit.emit({ event: 'admin.logout', subject: (req as any).user?.username ?? 'unknown' });
  }
  ```
- Not `@Public()` — requires the bearer so we know the subject.
- `clearCookie` must include `{ path: '/api/admin/auth' }` so the browser actually deletes the scoped cookie.

## Acceptance criteria
- [ ] `POST /api/admin/auth/logout` returns HTTP 204.
- [ ] Calls `RefreshTokenService.revoke` only if cookie present (via `AuthService.logout`).
- [ ] Emits `admin.logout` audit event with `subject = req.user?.username ?? 'unknown'`.
- [ ] `Set-Cookie` clears `ob_refresh` with `Path=/api/admin/auth`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0406]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1207], [TASK-1209], [TASK-1215]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7035–7045)
