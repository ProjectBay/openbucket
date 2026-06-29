---
id: TEST-0406
title: Logout endpoint e2e
covers: [STORY-0405, TASK-1212]
status: done
level: e2e
---

## Goal
Verify `POST /api/admin/auth/logout` revokes the refresh token, clears the cookie, emits `admin.logout`, and requires a bearer.

## Setup
- Boot backend with SQLite. Seed admin. Login to obtain bearer + refresh cookie.

## Cases
1. POST `/api/admin/auth/logout` with bearer + refresh cookie → 204; response sends `Set-Cookie: ob_refresh=; ...; Path=/api/admin/auth; Expires=...` (cookie cleared).
2. Subsequent refresh with that cookie → 401 `revoked`.
3. POST logout without bearer → 401 (global `JwtAuthGuard` rejects).
4. POST logout twice in a row with the same cookie → both return 204 (idempotent).
5. Audit line emitted with `"event":"admin.logout"`, `"subject":"<username>"`, `"audit":true`.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=auth-logout.e2e-spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7035–7045), §5.9 (line 7731)
