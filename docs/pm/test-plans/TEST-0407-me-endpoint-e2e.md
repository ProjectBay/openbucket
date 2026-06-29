---
id: TEST-0407
title: Me endpoint e2e
covers: [STORY-0406, TASK-1213, TASK-1214]
status: done
level: e2e
---

## Goal
Verify `GET /api/admin/auth/me` echoes JWT claims and requires a valid bearer.

## Setup
- Boot backend with SQLite. Seed admin user. Login to obtain bearer.

## Cases
1. GET with valid bearer → 200 with `{ id: <sub>, username: 'admin', mustChangePassword: <bool> }`.
2. GET without bearer → 401 `missing bearer`.
3. GET with malformed `Authorization` header (not `Bearer ...`) → 401.
4. GET with a tampered bearer (signature invalidated) → 401 `invalid token`.
5. When the seeded user has `mustChangePassword: true`, `/me` returns `mustChangePassword: true` (sourced from the JWT, not a DB read).

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=auth-me.e2e-spec.ts`

## Pass criteria
- [ ] All five cases pass.

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7047–7055)
