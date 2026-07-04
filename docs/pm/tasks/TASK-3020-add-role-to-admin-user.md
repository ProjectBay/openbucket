---
id: TASK-3020
title: Add role to AdminUser entity, migration, and repository
story: STORY-1002
status: backlog
type: implementation
size: M
---

## Description
Introduce the `AdminRole` type and persist it on the admin row. Add a `role`
column to `admin_users` with a forward-only migration that backfills the existing
bootstrap admin to `admin`, and extend `AdminUserRepository` with the read/write
helpers the CRUD API ([TASK-3022]) and role guard ([TASK-3021]) need. This is the
data-model foundation; it must not regress the single-admin bootstrap.

## Files to create / modify
- `libs/nestjs/src/lib/persistence/entities/types.ts` — modify (add `AdminRole` union + `ADMIN_ROLES` const, alongside the existing `PolicyDocument` exports).
- `libs/nestjs/src/lib/persistence/entities/admin-user.entity.ts` — modify (add `role` `@Property`).
- `libs/nestjs/src/lib/persistence/repositories/admin-user.repository.ts` — modify (widen `AdminUserSeed`, add `list`/`countByRole`/`delete`, widen `update`).
- `libs/nestjs/src/lib/migrations/Migration20260704000001_admin_user_roles.ts` — new.
- `libs/nestjs/src/lib/persistence/repositories/admin-user.repository.spec.ts` — new (or modify if present).

## Implementation notes
- Type (in `types.ts`, so persistence + admin can import it without a layering
  inversion): `export type AdminRole = 'admin' | 'readonly';` and
  `export const ADMIN_ROLES = ['admin', 'readonly'] as const;`.
- Entity property — text-stored enum, default keeps existing rows/bootstrap full:
  ```ts
  @Property({ type: 'string', length: 16, default: 'admin' })
  role: AdminRole = 'admin';
  ```
  Keep `role` LAST so column order matches the migration append.
- Migration mirrors `Migration20260603000001_admin_must_change_password` exactly
  (libsql, forward-only in prod; `down()` for test convenience):
  ```ts
  override async up(): Promise<void> {
    this.addSql(`alter table "admin_users" add column "role" text not null default 'admin';`);
  }
  override async down(): Promise<void> {
    this.addSql(`alter table "admin_users" drop column "role";`);
  }
  ```
  The `default 'admin'` backfills the seeded `admin` row — a read-only default
  would silently lock out the only operator (regression + DoS-on-self).
- Repository:
  - Extend `AdminUserSeed` with `role?: AdminRole` (optional; when omitted
    `em.create` applies the `'admin'` initializer, so `AdminBootstrapService`'s
    `insert`/`upsert` calls keep working unchanged and seed a full admin).
  - `list(): Promise<AdminUser[]>` → `this.findAll({ orderBy: { username: 'ASC' } })`.
  - `countByRole(role: AdminRole): Promise<number>` → `this.count({ role })` —
    the last-admin invariant in [TASK-3022] depends on this.
  - Widen `update`'s `changes` Pick to also allow `'role'`:
    `Partial<Pick<AdminUser, 'passwordHash' | 'mustChangePassword' | 'role'>>`.
  - `delete(username: string): Promise<void>` →
    `await this.getEntityManager().nativeUpdate` is for updates; for delete use
    `await this.getEntityManager().nativeDelete(AdminUser, { username })`.
- Edge cases / security: `length: 16` bounds the text column; the CRUD DTO
  ([TASK-3022]) is the actual validation boundary that rejects unknown role
  strings via `z.enum(ADMIN_ROLES)` — the DB default only guards migration-time
  rows. Never widen `AdminUserSeed`/summary to carry `passwordHash` outward.

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=admin-user.repository.spec` passes:
      `list`, `countByRole`, `delete`, and role-carrying `insert`/`update`.
- [ ] Running the migration on a DB seeded with the pre-change schema yields the
      existing `admin` row with `role = 'admin'` (verified in the repo spec).
- [ ] `AdminBootstrapService` still seeds a working full admin with no code change
      (`nx test nestjs --testPathPattern=admin-bootstrap` still green).

## Test obligations
- Unit: covered by [TEST-1002] cases 1–2.
- E2E: covered by [TEST-1002] (via CRUD/guard cases).
- Conformance: N/A — admin control plane, not S3.

## Dependencies
- Blocked by: none.
