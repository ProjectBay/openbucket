---
id: TEST-0403
title: Refresh-token rotation and reuse-revocation e2e
covers: [STORY-0402, STORY-0404, TASK-1206, TASK-1211]
status: done
level: e2e
---

## Goal
End-to-end verification of the security-critical refresh rotation path: every refresh issues a new token; replaying a rotated token revokes the chain.

## Setup
- Boot the backend against an in-memory SQLite database with migrations applied.
- Seed an admin user with known credentials.
- Use supertest with a cookie jar so the `ob_refresh` cookie persists across requests.

## Cases
1. Login → 200 with access token + cookie A. Refresh with cookie A → 200 with cookie B (B != A). Refresh with cookie B → 200 with cookie C (C != B).
2. **Reuse detection**: login → A; refresh A → B; now refresh A *again* → 401 `'token reuse detected'`. Subsequent refresh with B → 401 (chain revoked).
3. Login → A. Manually expire cookie A's row in DB (or advance test clock past TTL). Refresh A → 401 `'expired'`.
4. Login → A. Logout via `POST /api/admin/auth/logout` (with cookie A and a bearer). Refresh A → 401 `'revoked'`.
5. Cookie attributes inspection on every login/refresh response: `Set-Cookie` header includes `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/admin/auth`.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=auth-refresh-rotation.e2e-spec.ts`

## Pass criteria
- [ ] All five cases pass.
- [ ] No flake under repeated runs (5x) — rotation is deterministic.

## References
- `docs/WHITEPAPER.md` §5.2.3 (lines 6946–6977), §5.2.4 (lines 7021–7045)
