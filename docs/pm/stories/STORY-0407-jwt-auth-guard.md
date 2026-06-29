---
id: STORY-0407
title: Implement JwtAuthGuard global admin guard
epic: EPIC-05
status: done
size: S
risk: medium
---

## User story
As a developer, I want a `JwtAuthGuard` that authenticates every `/api/admin/*` request unless explicitly `@Public()`, so that all admin endpoints inherit auth without per-handler decoration and the S3 / SPA trees are never affected.

## Description
Implement `apps/backend/src/admin/auth/jwt-auth.guard.ts` per §5.3. The guard early-returns `true` for any `req.path` not starting with `/api/admin/` (safety net so S3 / SPA paths are never 401'd by this guard). Reads `IS_PUBLIC_KEY` reflector metadata; if public, returns true. Otherwise reads `Authorization: Bearer <token>`, verifies with `JwtService.verifyAsync` using `issuer: 'openbucket', audience: 'openbucket-admin'`, and attaches the decoded `AdminJwtPayload` to `req.user`. Throws `UnauthorizedException` on missing header, malformed bearer, or verification failure.

## Acceptance criteria
- [x] `canActivate` returns `true` for any request whose `path` does not start with `/api/admin/`.
- [x] Returns `true` when the handler or class is annotated `@Public()`.
- [x] Missing or non-`Bearer ` header → `UnauthorizedException('missing bearer')`.
- [x] Invalid token, expired token, or wrong issuer/audience → `UnauthorizedException('invalid token')`.
- [x] On success, `req.user` is set to the decoded `AdminJwtPayload` (`{ sub, username, mustChangePassword, iat, exp }`).
- [x] Verification uses `{ issuer: 'openbucket', audience: 'openbucket-admin' }`.

## Tasks
- [TASK-1215] Define `AdminJwtPayload` and implement `JwtAuthGuard.canActivate`

## Test plan
- [TEST-0408] JwtAuthGuard unit spec

## Dependencies
- Blocks: [STORY-0405], [STORY-0406], [STORY-0409], [STORY-0410], [STORY-0411], [STORY-0412]
- Blocked by: [STORY-0400], [STORY-0401]

## References
- `docs/WHITEPAPER.md` §5.3 (lines 7081–7144)
- Interfaces produced: `JwtAuthGuard`, `AdminJwtPayload`
