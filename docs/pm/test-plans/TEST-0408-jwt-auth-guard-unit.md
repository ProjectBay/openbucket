---
id: TEST-0408
title: JwtAuthGuard unit spec
covers: [STORY-0407, TASK-1215, TASK-1210]
status: done
level: unit
---

## Goal
Verify the guard's four branches: non-admin path, `@Public()`, missing/malformed bearer, valid bearer.

## Setup
- Instantiate `JwtAuthGuard` with a stub `Reflector` and a stub `JwtService` whose `verifyAsync` is controllable per test.
- Build `ExecutionContext` fixtures returning a mock `Request` with configurable `path`, `headers.authorization`.

## Cases
1. Given `req.path = '/api/s3/bucket/key'`, `canActivate` returns `true` without consulting reflector or jwt.
2. Given `req.path = '/admin/login'` (SPA route, not API), `canActivate` returns `true` without consulting jwt.
3. Given `req.path = '/api/admin/auth/login'` and `Reflector.getAllAndOverride` returns `true` for `IS_PUBLIC_KEY`, `canActivate` returns `true`.
4. Given `req.path = '/api/admin/buckets'` and missing `authorization` header → `UnauthorizedException('missing bearer')`.
5. Given header `Authorization: Token abc` (not Bearer) → `UnauthorizedException('missing bearer')`.
6. Given header `Authorization: Bearer xxx` and `jwt.verifyAsync` rejects → `UnauthorizedException('invalid token')`.
7. Given header `Authorization: Bearer xxx` and `jwt.verifyAsync` resolves with `{ sub, username, mustChangePassword, iat, exp }`, `canActivate` returns `true` and `req.user` equals the payload.
8. `jwt.verifyAsync` is invoked with options `{ issuer: 'openbucket', audience: 'openbucket-admin' }`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=jwt-auth.guard.spec.ts`

## Pass criteria
- [ ] All eight cases pass.

## References
- `docs/WHITEPAPER.md` §5.3 (lines 7081–7144)
