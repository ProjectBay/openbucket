---
id: TEST-1002
title: Multi-admin roles — enforcement, CRUD guardrails, and console gating
covers: [STORY-1002, TASK-3020, TASK-3021, TASK-3022, TASK-3023, TASK-3024]
status: backlog
level: integration
---

## Goal
Verify that admin roles persist correctly, that a read-only admin is denied all
state-changing operations while retaining reads and self-service, that role
changes take effect immediately (fresh-read, not stale token), that the
admin-users CRUD API enforces its anti-lockout guardrails and never leaks
`passwordHash`, and that the console hides mutating controls and blocks the
`/users` route for read-only principals.

## Setup
- Backend `nestjs` unit specs run under `nx test nestjs` with the in-memory/libsql
  test EM; `apps/openbucket-frontend` specs under `nx test openbucket-frontend`.
- Fixtures: seed two admins — `alice` (`role='admin'`) and `bob`
  (`role='readonly'`) — via `AdminUserRepository.insert`. For HTTP cases mint
  access tokens through `AuthService.login`, and read the `ob_refresh` cookie for
  session-revocation assertions.
- Guard specs stub `Reflector`, `JwtService`, and `AdminUserRepository` and build
  an Express-like `req` with `path`, `method`, and (post-`JwtAuthGuard`) `user`.

## Cases
1. **Migration backfill (TASK-3020).** Given a DB at the pre-role schema with the
   seeded `admin` row; when `Migration20260704000001_admin_user_roles.up()` runs;
   then `admin_users` has a `role` column and the existing row reads
   `role = 'admin'`.
2. **Repository helpers (TASK-3020).** `insert`/`update` round-trip `role`;
   `list()` returns username-ordered rows; `countByRole('admin')` reflects seeded
   counts; `delete('bob')` removes the row.
3. **Read-only blocked on mutations (TASK-3021).** Given `bob` (readonly); when he
   issues `DELETE /api/admin/buckets/x` (and `POST`/`PATCH` variants); then
   `RolesGuard` throws `403 Forbidden` and the handler never runs.
4. **Read-only allowed on reads (TASK-3021).** `bob` `GET /api/admin/users` and
   `GET /api/admin/buckets` → `200`.
5. **Read-only self-service allowlist (TASK-3021).** `bob`
   `POST /api/admin/settings/change-password` (valid current pw) → `204`, and
   `POST /api/admin/auth/logout` → `204`; both bypass the role denial.
6. **Fresh-read prevents stale-token escalation (TASK-3021).** Given a token
   minted while `bob.role='admin'`; when `bob` is demoted to `readonly` in the DB
   and then issues a mutating request with that still-valid token; then the guard
   403s because it authorizes off the fresh DB role attached by `JwtAuthGuard`.
7. **me returns role (TASK-3021).** `GET /api/admin/auth/me` for `alice` returns
   `{ ..., role: 'admin' }`; response schema/OpenAPI includes `role`.
8. **Create admin (TASK-3022).** `alice` `POST /api/admin/users`
   `{username:'carol', password:'<12+ chars>', role:'readonly'}` → `201`, body is
   a summary with `mustChangePassword: true` and **no** `passwordHash`; `carol`
   can then log in and is forced to rotate.
9. **Duplicate + validation (TASK-3022).** Re-creating `carol` → `409`; password
   `< 12` chars → `400`; username `bad name!` (regex) or `>64` chars → `400`;
   unknown `role` → `400`.
10. **No self-delete / last-admin delete (TASK-3022).** `alice`
    `DELETE /api/admin/users/alice` → `403`; with `alice` the only `admin`,
    deleting any lone remaining admin → `409` ("cannot remove the last full admin").
11. **Last-admin demote (TASK-3022).** With `alice` the only `admin`,
    `PATCH /api/admin/users/alice {role:'readonly'}` → `409`.
12. **Password reset revokes sessions (TASK-3022).** `alice`
    `PATCH /api/admin/users/bob {newPassword:'<12+>'}`; then `bob`'s previously
    issued refresh token → `POST /api/admin/auth/refresh` returns `401`
    (`revokeAllForSubject` was called); `bob.mustChangePassword` is now `true`.
13. **Role change is live (TASK-3022 + 3021).** `alice`
    `PATCH /api/admin/users/bob {role:'admin'}`; `bob`'s next mutating request now
    succeeds without re-login (guard reads fresh role).
14. **Audit events (TASK-3022 + 3024).** Create/role-change/password-reset/delete
    each emit `admin.user.created` / `admin.user.role.changed` (with `from`/`to`)
    / `admin.user.password.reset` / `admin.user.deleted`, each carrying `subject`
    (actor) and `target`.
15. **Console gating (TASK-3023).** Signed in as read-only: the `/users` nav entry
    is absent, deep-linking `/users` is redirected to `/` by `fullAdminGuard`, and
    create/delete buttons are not rendered; signed in as full admin: create /
    change-role / reset-password / delete a peer completes end to end.
16. **Client + OpenAPI surface (TASK-3024).** The regenerated `@openbucket/api-client`
    exposes `AdminUsersService` (`listAdminUsers`/`createAdminUser`/
    `updateAdminUser`/`deleteAdminUser`); the OpenAPI export lists the four
    `/api/admin/users` operations and `role` on `MeResponseDto`.

## Tooling
- Framework: jest (backend unit + guard/service specs), supertest (admin HTTP),
  jest + Angular TestBed (console store/guard/component specs).
- Runner: `nx test nestjs`, `nx e2e openbucket-backend-e2e`, `nx test openbucket-frontend`.

## Pass criteria
- [ ] All 16 cases pass.
- [ ] No response body in any admin-users case contains `passwordHash`.
- [ ] EPIC-08 authz suites (`policy-evaluator.spec`, S3 conformance) remain green —
      no regression to the S3 data-plane authorization.

## References
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.spec.ts`, `refresh-token.service.spec.ts` — existing test patterns.
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` — CRUD test shape.
- `apps/openbucket-frontend/src/app/auth/auth.guard.spec.ts` — console guard test shape.
