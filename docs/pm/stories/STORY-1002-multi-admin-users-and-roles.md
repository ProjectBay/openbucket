---
id: STORY-1002
title: Multi-admin users & roles
epic: EPIC-11
status: backlog
size: M
risk: medium
---

## User story
As an operator, I want to create additional admin users and assign each one a
read-only or full-admin role, so that I can grant teammates least-privilege
access to the console and API without sharing the single bootstrap credential.

## Description
Today the admin plane is single-tenant: `AdminUser`
(`libs/nestjs/src/lib/persistence/entities/admin-user.entity.ts`) is a
username-keyed row with no role, seeded once by `AdminBootstrapService`, and every
authenticated principal has full power. This Story adds a `role` field
(`admin` | `readonly`), a `RolesGuard` that default-denies state-changing HTTP
methods for read-only principals, and an admin-user CRUD surface
(`/api/admin/users`) plus a console screen for listing, creating, editing role /
resetting password, and deleting admins. It reuses the existing global
`JwtAuthGuard` DB read to attach a **fresh** role to `req.user` (so a demoted
admin loses power immediately, not after token expiry), the `argon2id` hashing
and session-revocation patterns from the change-password flow, and the
nestjs-zod DTO + signals-store conventions. It preserves the EPIC-08 security
posture: no change to `s3/authz/policy-evaluator`, `storage/key-codec`, or the
throttler buckets, and it never exposes `passwordHash`.

## Acceptance criteria
- [ ] `admin_users` has a `role` column (`admin` | `readonly`) defaulting to
      `admin`; a forward-only migration backfills the existing row to `admin` so
      the current single admin is not regressed.
- [ ] A read-only principal receives `403 Forbidden` on any state-changing admin
      request (POST/PUT/PATCH/DELETE) except the self-service allowlist
      (`settings/change-password`, `auth/logout`); all `GET` reads still succeed.
- [ ] Authorization decisions use a fresh DB role read (via the existing
      `JwtAuthGuard` lookup), so demoting an admin takes effect on their next
      request even while their 15-minute access token is still valid.
- [ ] `GET /api/admin/users` lists all admins (both roles may read);
      `POST`/`PATCH`/`DELETE /api/admin/users` are full-admin only and never
      return `passwordHash`.
- [ ] The last remaining full-admin cannot be deleted or demoted, and an admin
      cannot delete their own account (both return a 4xx, not a 500).
- [ ] Deleting an admin, or resetting their password, revokes all of that
      subject's refresh sessions immediately (`RefreshTokenService.revokeAllForSubject`).
- [ ] `GET /api/admin/auth/me` returns the caller's `role`; the console hides
      mutating controls and blocks the `/users` route for read-only principals
      (server enforcement remains authoritative).
- [ ] Audit events `admin.user.created`, `admin.user.role.changed`,
      `admin.user.password.reset`, and `admin.user.deleted` are emitted with a
      `subject` (the actor) and `target` field.

## Tasks
- [TASK-3020] Add role to AdminUser entity, migration, and repository
- [TASK-3021] Enforce roles via fresh-read JWT guard and RolesGuard
- [TASK-3022] Build the admin-users CRUD API with lockout guardrails
- [TASK-3023] Add the console admin-users screen and read-only gating
- [TASK-3024] Regenerate the API client and extend the audit catalogue

## Test plan
- [TEST-1002] Multi-admin roles: enforcement, CRUD guardrails, and console gating

## Dependencies
- Blocks: none in EPIC-11 yet (foundation for later per-role scoping stories).
- Blocked by: none. Builds directly on shipped EPIC-04/EPIC-08 admin plane
  (`JwtAuthGuard`, `AuthService`, `AdminBootstrapService`, `RefreshTokenService`).
- Reuses EPIC-08 authz posture: the S3 data-plane authorization
  (`s3/authz/policy-evaluator.ts`, `storage/key-codec.ts`) and access-key `role`
  field are untouched — this Story governs only the **admin** control plane.

## References
- `libs/nestjs/src/lib/persistence/entities/admin-user.entity.ts` — the row this Story extends.
- `libs/nestjs/src/lib/persistence/repositories/admin-user.repository.ts` — `findByUsername`/`insert`/`upsert`/`update`.
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts` — global guard; `AdminJwtPayload`, `FORCED_ROTATION_ALLOWLIST` precedent.
- `libs/nestjs/src/lib/admin/auth/jwt.strategy.ts` — passport claims interface.
- `libs/nestjs/src/lib/admin/auth/auth.service.ts` — `issueTokens` JWT claims.
- `libs/nestjs/src/lib/admin/auth/auth.controller.ts` — `me()` echoes claims.
- `libs/nestjs/src/lib/admin/settings/settings-admin.controller.ts` — argon2 + `revokeAllForSubject` precedent.
- `libs/nestjs/src/lib/admin/bootstrap/admin-bootstrap.service.ts` — first-run seeding.
- `libs/nestjs/src/lib/admin/admin.module.ts` — `ADMIN_CONTROLLER_MODULES`, `APP_GUARD` wiring.
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` — event catalogue.
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` + `dto/` — CRUD + nestjs-zod DTO template.
- `libs/nestjs/src/lib/migrations/Migration20260603000001_admin_must_change_password.ts` — migration template.
- `apps/openbucket-frontend/src/app/keys/keys.signal-store.ts`, `apps/openbucket-frontend/src/app/auth/auth.service.ts`, `apps/openbucket-frontend/src/app/auth/auth.guard.ts`, `apps/openbucket-frontend/src/app/app.routes.ts` — console patterns.
- New deps: none. Regenerated `@openbucket/api-client` (existing OpenAPI codegen target) gains `AdminUsersService`.
