---
id: TASK-1215
title: Define AdminJwtPayload and implement JwtAuthGuard.canActivate
story: STORY-0407
status: done
type: implementation
size: S
---

## Description
Implement the global `JwtAuthGuard` for `/api/admin/*`. The guard early-returns for non-admin paths (safety net), honors `@Public()` via Reflector, and verifies the bearer with issuer/audience constraints.

## Files to create / modify
- `apps/backend/src/admin/auth/jwt-auth.guard.ts` — new

## Implementation notes
- Payload interface verbatim:
  ```ts
  export interface AdminJwtPayload {
    sub: string;
    username: string;
    mustChangePassword: boolean;
    iat: number;
    exp: number;
  }
  ```
- Verbatim body from §5.3 (lines 7104–7138):
  ```ts
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.path.startsWith('/api/admin/')) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer');

    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        issuer: 'openbucket',
        audience: 'openbucket-admin',
      });
      (req as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }
  ```
- The path-prefix check is the safety net so S3 and SPA never see a 401 from this guard.

## Acceptance criteria
- [ ] Non-`/api/admin/` requests are never rejected by this guard.
- [ ] `@Public()` handlers / classes bypass auth.
- [ ] Verification uses `{ issuer: 'openbucket', audience: 'openbucket-admin' }`.
- [ ] On success, `req.user = AdminJwtPayload`.

## Test obligations
- Unit: covered by [TEST-0408]
- E2E: covered by [TEST-0404], [TEST-0407], [TEST-0411], [TEST-0413], [TEST-0415], [TEST-0417]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1202], [TASK-1210]

## References
- `docs/WHITEPAPER.md` §5.3 (lines 7081–7144)
