---
id: TASK-1211
title: Implement AuthController.refresh with cookie rotation
story: STORY-0404
status: done
type: implementation
size: S
---

## Description
Add the `refresh` handler to `AuthController`. Reads `req.cookies?.[REFRESH_COOKIE]`, calls `AuthService.refresh(raw)`, sets a new cookie with the rotated value, and returns `{ accessToken, expiresIn }`.

## Files to create / modify
- `apps/backend/src/admin/auth/auth.controller.ts` — modify (add `refresh` method)

## Implementation notes
- Verbatim from §5.2.4 lines 7021–7033:
  ```ts
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException('missing refresh');
    const tokens = await this.auth.refresh(raw);
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }
  ```
- No audit emission per §5.9 catalogue.

## Acceptance criteria
- [ ] `POST /api/admin/auth/refresh` returns HTTP 200 with `{ accessToken, expiresIn }`.
- [ ] Missing cookie → 401 `'missing refresh'`.
- [ ] Sets a new `ob_refresh` cookie with the same five attributes; cookie value differs from the previous one.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0405], [TEST-0403]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1203], [TASK-1206], [TASK-1209]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7021–7033)
