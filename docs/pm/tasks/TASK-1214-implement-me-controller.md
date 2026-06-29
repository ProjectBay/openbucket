---
id: TASK-1214
title: Implement AuthController.me
story: STORY-0406
status: done
type: implementation
size: XS
---

## Description
Add the `me` handler to `AuthController`. Sources every field from the decoded JWT on `req.user`.

## Files to create / modify
- `apps/backend/src/admin/auth/auth.controller.ts` — modify (add `me` method)

## Implementation notes
- Verbatim from §5.2.4 lines 7047–7055:
  ```ts
  @Get('me')
  me(@Req() req: Request): MeResponseDto {
    const user = (req as any).user as { sub: string; username: string; mustChangePassword: boolean };
    return {
      id: user.sub,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }
  ```
- No DB read — purely a claim echo.

## Acceptance criteria
- [ ] `GET /api/admin/auth/me` returns 200 with `{ id, username, mustChangePassword }` from JWT claims.
- [ ] 401 when bearer missing or invalid (via global `JwtAuthGuard`).

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0407]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1213], [TASK-1215]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7047–7055)
