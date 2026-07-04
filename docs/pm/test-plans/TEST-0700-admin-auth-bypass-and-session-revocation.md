---
id: TEST-0700
title: Admin auth-bypass and session-revocation e2e
covers: [STORY-0700, TASK-2100, TASK-2101, TASK-2102]
status: ready
level: e2e
---

## Goal
Prove the admin surface is fail-closed after remediation: mixed-case admin paths cannot bypass the JWT guard (finding [1]), a password change revokes outstanding refresh tokens (finding [3]), and a `mustChangePassword` principal is confined to the change-password endpoint against a fresh DB read (finding [9]).

## Setup
- Boot the standalone backend (`apps/openbucket-backend`) against an in-memory / temp-dir SQLite instance, with strict/case-sensitive routing enabled per [TASK-2100].
- Seed an admin via the temp-password bootstrap branch (`mustChangePassword: true`) for the finding-[9] cases; for finding-[1]/[3] cases, provision via `ADMIN_PASSWORD_HASH` (`mustChangePassword: false`) and log in to obtain a bearer + `ob_refresh` cookie.
- Framework: jest + supertest. Runner: `nx e2e backend-e2e --testPathPattern=admin-auth-hardening.e2e-spec.ts`.

## Cases

### Finding [1] — case-sensitivity bypass (TASK-2100)
1. `GET /api/Admin/backup` with **no** Authorization header → **401** (before fix: 200 with a full `.zip` body). Assert no zip bytes are streamed.
2. `GET /api/ADMIN/buckets` and `GET /API/ADMIN/keys` with no bearer → **401** each.
3. `POST /api/Admin/restore` with no bearer → **401** (the instance is not reset).
4. Regression / no-op guard: `GET /api/admin/buckets` **with** a valid bearer → **200**; the same path without a bearer → **401**. The canonical lowercase path is unchanged.

### Finding [3] — session revocation on password change (TASK-2101)
5. Log in → capture `ob_refresh` cookie value `R`. `POST /api/admin/settings/change-password` with the correct current password + a valid new password → **204**. Then `POST /api/admin/auth/refresh` presenting the captured `R` → **401** `revoked`. A fresh login after the change can still refresh successfully (new chain unaffected).

### Finding [9] — mustChangePassword enforcement (TASK-2102)
6. Log in as the temp-password admin (`mustChangePassword: true`) → bearer `T`. `GET /api/admin/buckets` with `T` → **403**. `GET /api/admin/auth/me` and `POST /api/admin/auth/logout` with `T` → allowed (**200 / 2xx**). `POST /api/admin/settings/change-password` with `T` → **204**; afterwards `GET /api/admin/buckets` with a freshly issued token → **200**.
7. `refresh()` claim freshness: for a `mustChangePassword: true` admin, `POST /api/admin/auth/refresh` yields an access token whose decoded `mustChangePassword` claim is **true** (not hardcoded `false`), and that token is still 403'd on `GET /api/admin/buckets` (enforcement reads the DB row, so the guard blocks it regardless of the claim).

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e backend-e2e --testPathPattern=admin-auth-hardening.e2e-spec.ts`

## Pass criteria
- [ ] Cases 1–4 (finding [1]) pass: every mixed-case admin path without a bearer returns 401; canonical authenticated path still 200.
- [ ] Case 5 (finding [3]) passes: pre-change refresh token is rejected after password change.
- [ ] Cases 6–7 (finding [9]) pass: forced-rotation principal is confined to change-password/logout/me and enforcement is DB-driven.

## References
- Audit findings [1] (CWE-178/CWE-289), [3] (CWE-613), [9] (CWE-620).
- `docs/WHITEPAPER.md` §5.2, §5.3, §5.8.
- Source: `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts:51`, `libs/nestjs/src/lib/admin/settings/settings-admin.controller.ts:40`, `libs/nestjs/src/lib/admin/auth/auth.service.ts:54,62`, `libs/nestjs/src/lib/admin/backup/backup.controller.ts:29`.
