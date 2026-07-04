---
id: TASK-3022
title: Build the admin-users CRUD API with lockout guardrails
story: STORY-1002
status: backlog
type: implementation
size: M
---

## Description
Expose admin-user management at `/api/admin/users`: list (both roles), create,
update (role and/or password reset), and delete (full-admin only, enforced by the
[TASK-3021] `RolesGuard`). Add a domain service holding the lockout invariants
(never remove the last full admin, never self-delete) and reusing the argon2id
hashing and `revokeAllForSubject` session-eviction patterns already used by
change-password. Emit audit events for every mutation.

## Files to create / modify
- `libs/nestjs/src/lib/domain/admin-users/admin-users.service.ts` — new.
- `libs/nestjs/src/lib/admin/users/admin-users.controller.ts` — new.
- `libs/nestjs/src/lib/admin/users/admin-users.module.ts` — new.
- `libs/nestjs/src/lib/admin/users/dto/create-admin-user.dto.ts` — new.
- `libs/nestjs/src/lib/admin/users/dto/update-admin-user.dto.ts` — new.
- `libs/nestjs/src/lib/admin/users/dto/admin-user-summary.dto.ts` — new.
- `libs/nestjs/src/lib/admin/admin.module.ts` — modify (add `AdminUsersModule` to `ADMIN_CONTROLLER_MODULES`).
- `libs/nestjs/src/lib/open-bucket.module.ts` — modify (add `AdminUsersModule` to the host-mount RouterModule children).
- `libs/nestjs/src/lib/domain/admin-users/admin-users.service.spec.ts` — new.
- `libs/nestjs/src/lib/admin/users/admin-users.controller.spec.ts` — new.

## Implementation notes
- **DTOs (nestjs-zod, mirroring `dto/change-password.dto.ts` + `keys/dto/*`)**:
  ```ts
  export const CreateAdminUserSchema = z.object({
    username: z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/, 'invalid username'),
    password: z.string().min(12, 'password must be at least 12 characters'),
    role: z.enum(ADMIN_ROLES),
  });
  export const UpdateAdminUserSchema = z.object({
    role: z.enum(ADMIN_ROLES).optional(),
    newPassword: z.string().min(12).optional(),
  }).refine((v) => v.role !== undefined || v.newPassword !== undefined,
            { message: 'nothing to update' });
  ```
  `AdminUserSummarySchema`: `{ username, role, mustChangePassword, createdAt }`.
  **Never** put `passwordHash` in a summary/response DTO. `max(64)` matches the
  entity PK `length: 64`; the regex bounds the PK to safe key characters.
- **Controller** `@Controller('api/admin/users')` (guarded by the global
  `JwtAuthGuard`; mutations gated by the global `RolesGuard` via HTTP method — no
  per-handler role decorator needed):
  ```ts
  @Get()                     list(): Promise<AdminUserSummaryDto[]>
  @Post() @HttpCode(201)     create(@Body dto, @Req req): Promise<AdminUserSummaryDto>
  @Patch(':username')        @HttpCode(204) update(@Param username, @Body dto, @Req req)
  @Delete(':username')       @HttpCode(204) remove(@Param username, @Req req)
  ```
  The actor is `(req.user as AdminJwtPayload).username`. Add `@ApiOperation`
  operationIds (`listAdminUsers`, `createAdminUser`, `updateAdminUser`,
  `deleteAdminUser`) so the codegen client ([TASK-3024]) names methods cleanly.
- **Service** (`AdminUsersService`, injects `AdminUserRepository`, `AuditService`,
  `RefreshTokenService`):
  - `create({ username, password, role })`: if `findByUsername` hits →
    `ConflictException` (409); else `argon2.hash(password, { type: argon2.argon2id })`
    and `repo.insert({ username, passwordHash, role, mustChangePassword: true })`
    so a newly-created admin must rotate the operator-set password on first login
    (same posture as bootstrap branch 2). Emit `admin.user.created`.
  - `update(username, { role, newPassword }, actor)`: load or 404. If demoting
    (`role === 'readonly'` on a current `admin`) call `assertNotLastAdmin`. If
    `newPassword`: hash, set `mustChangePassword: true`, and
    `refreshTokens.revokeAllForSubject(username)` (CWE-613 — a reset must kill the
    target's live sessions, exactly like change-password). Persist via
    `repo.update`. Emit `admin.user.role.changed` (with `from`/`to`) and/or
    `admin.user.password.reset`.
  - `remove(username, actor)`: `if (username === actor) throw new ForbiddenException`
    (no self-delete — avoids the confusing lock-yourself-out path); then
    `assertNotLastAdmin(username)`; `repo.delete`; `revokeAllForSubject`; emit
    `admin.user.deleted`.
  - `assertNotLastAdmin(username)`: load target; if `target.role === 'admin'` and
    `await repo.countByRole('admin') <= 1` → `ConflictException('cannot remove the last full admin')`.
    This is the anti-lockout invariant; it also covers self-demotion of the last
    admin because the guard runs before the DB check regardless of who the actor is.
- **Module** `AdminUsersModule`: `controllers: [AdminUsersController]`,
  `providers: [AdminUsersService, AuditService, RefreshTokenService]` — same
  stateless-service pattern `SettingsAdminModule` uses (`AdminUserRepository`,
  `Clock`, and `RefreshTokenRepository` are globally provided, so a second
  `RefreshTokenService` copy is safe). Add to `ADMIN_CONTROLLER_MODULES` AND to
  the RouterModule children in `open-bucket.module.ts`, or the mounted
  `<mountPath>/api/admin/users` tree stays unrouted (documented failure mode in
  `admin.module.ts`).
- Edge cases / security / DoS: argon2id is CPU-bound but create/reset are
  full-admin-only and already sit behind the `default` 100/min admin throttler
  bucket, so no new DoS surface. Duplicate-username is a benign 409 on an already
  authenticated surface (no enumeration concern — admins can list anyway). Role
  is validated by `z.enum`, so an unknown role is a 400 before it can reach the
  DB. `passwordHash` is never serialized.

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=admin-users` passes create/list/update/delete
      plus the four guardrails (409 duplicate, 409 last-admin delete, 409 last-admin
      demote, 403 self-delete).
- [ ] Create returns 201 with `mustChangePassword: true` and no `passwordHash`;
      list/summary never include `passwordHash`.
- [ ] Password reset and delete both call `revokeAllForSubject` (asserted via mock).
- [ ] OpenAPI export contains the four `/api/admin/users` operations with the
      declared operationIds.

## Test obligations
- Unit: covered by [TEST-1002] cases 8–14.
- E2E: covered by [TEST-1002] cases 8–13 via HTTP.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3020], [TASK-3021].
