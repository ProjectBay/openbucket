---
id: TEST-0405
title: Refresh endpoint e2e
covers: [STORY-0404, TASK-1211]
status: done
level: e2e
---

## Goal
Verify `POST /api/admin/auth/refresh` reads the cookie, issues a new access token, rotates the cookie value, and rejects missing-cookie requests. Rotation correctness (and reuse) is covered by [TEST-0403].

## Setup
- Boot backend with SQLite. Seed admin. Login first to obtain the refresh cookie.

## Cases
1. POST `/api/admin/auth/refresh` with valid cookie → 200 with `{ accessToken, expiresIn: 900 }` and a fresh `Set-Cookie: ob_refresh=...` whose value differs from the previous one.
2. POST without the cookie → 401 `missing refresh`.
3. POST with a syntactically valid but never-issued token → 401 `invalid refresh`.
4. Cookie attributes match login: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/admin/auth`.
5. Refresh does NOT emit an audit event (read-only-ish; §5.9 catalogue omits refresh).

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=auth-refresh.e2e-spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7021–7033)
