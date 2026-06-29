---
id: TEST-0404
title: Login endpoint e2e
covers: [STORY-0403, TASK-1208, TASK-1209, TASK-1210]
status: done
level: e2e
---

## Goal
Verify `POST /api/admin/auth/login` issues the JWT, sets the cookie, throttles after five hits, and emits the audit event.

## Setup
- Boot backend against in-memory SQLite. Seed admin user with known password.
- Capture stdout to assert audit event lines.

## Cases
1. POST valid credentials → 200 with `{ accessToken, expiresIn: 900 }` and `Set-Cookie: ob_refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth`.
2. POST wrong password → 401 `invalid credentials`.
3. POST unknown user → 401 `invalid credentials` (and elapsed time within 50 ms of the wrong-password case, confirming constant-time path).
4. POST six times from the same client within 60 s → sixth request returns 429 (login throttler).
5. Successful login emits an audit line containing `"event":"admin.login"`, `"subject":"<username>"`, `"ip":"<ip>"`, `"audit":true`.
6. The decoded access token JWT has claims `sub`, `username`, `mustChangePassword`, plus `iss: 'openbucket'`, `aud: 'openbucket-admin'`, and `exp - iat = 900`.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=auth-login.e2e-spec.ts`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7005–7019, 7057–7066), §5.9 (lines 7727–7733)
