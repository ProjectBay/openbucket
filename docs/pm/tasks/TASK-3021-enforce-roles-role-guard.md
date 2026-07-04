---
id: TASK-3021
title: Enforce roles via fresh-read JWT guard and RolesGuard
story: STORY-1002
status: backlog
type: implementation
size: M
---

## Description
Carry `role` through the token/claims path and enforce it. Extend the existing
global `JwtAuthGuard` to attach the **fresh** DB role onto `req.user` (reusing the
lookup it already performs for `mustChangePassword`), sign `role` into access
tokens, and add a `RolesGuard` (bound as a second `APP_GUARD`) that default-denies
state-changing HTTP methods for read-only principals with a self-service
allowlist. Surface `role` on `GET /api/admin/auth/me`.

## Files to create / modify
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts` — modify (`role` in `AdminJwtPayload`; attach fresh role).
- `libs/nestjs/src/lib/admin/auth/jwt.strategy.ts` — modify (`role` in claims + `validate`).
- `libs/nestjs/src/lib/admin/auth/auth.service.ts` — modify (sign `role`; re-derive on refresh).
- `libs/nestjs/src/lib/admin/auth/roles.guard.ts` — new.
- `libs/nestjs/src/lib/admin/auth/allow-readonly.decorator.ts` — new (`@AllowReadOnly()` + `ALLOW_READONLY_KEY`).
- `libs/nestjs/src/lib/admin/admin.module.ts` — modify (add `{ provide: APP_GUARD, useClass: RolesGuard }` after `JwtAuthGuard`).
- `libs/nestjs/src/lib/admin/auth/auth.controller.ts` — modify (`me()` returns `role`).
- `libs/nestjs/src/lib/admin/auth/dto/me-response.dto.ts` — modify (add `role`).
- `libs/nestjs/src/lib/admin/auth/roles.guard.spec.ts` — new.
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.spec.ts` — modify (assert attached role).

## Implementation notes
- **Claims**: add `role: AdminRole` to the `AdminJwtPayload` interfaces in BOTH
  `jwt-auth.guard.ts` and `jwt.strategy.ts` and return it from `validate`. In
  `AuthService.issueTokens`, add `role` to the signed payload. `login` passes
  `user.role`; `refresh` re-derives from the persisted row (same place it already
  re-reads `mustChangePassword` — do NOT hardcode), defaulting to `'readonly'`
  (least privilege) if the row vanished.
- **Fresh-read authorization (the security crux, mirrors CWE-620 handling)**:
  `JwtAuthGuard.canActivate` already does
  `const user = await this.users.findByUsername(payload.sub)` for the
  must-change check. Reuse that single read: set
  `(req.user as AdminJwtPayload).role = user?.role ?? 'readonly'` so
  authorization runs off the live DB value, not the possibly-stale token claim.
  This makes a demotion effective on the very next request even while the old
  15-minute token still verifies — no extra query beyond what the guard already
  issues.
- **RolesGuard** (`CanActivate`, constructed like `JwtAuthGuard` with `Reflector`
  + optional `OPEN_BUCKET_OPTIONS` for the mount-aware, lower-cased `adminPrefix`):
  ```ts
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  // self-service routes a read-only admin must still reach (mirror of
  // JwtAuthGuard.FORCED_ROTATION_ALLOWLIST, relative to adminPrefix, lower-cased)
  private static readonly READONLY_ALLOWLIST = new Set([
    'settings/change-password',
    'auth/logout',
  ]);
  ```
  Logic, default-deny:
  1. `if (!req.path.toLowerCase().startsWith(this.adminPrefix)) return true;` —
     S3 + SPA safety net, identical to `JwtAuthGuard`.
  2. `if (!MUTATING.has(req.method.toUpperCase())) return true;` — reads always allowed.
  3. `const principal = req.user;` if `undefined` return `true` — this is a
     `@Public` mutating route (login/refresh); `JwtAuthGuard` intentionally left
     `req.user` unset, and auth, not role, gates those.
  4. `if (principal.role !== 'readonly') return true;` — full admin.
  5. Read-only: allow if `@AllowReadOnly()` metadata is set on handler/class, OR
     the sub-path (`path.slice(adminPrefix.length)`, lower-cased) is in
     `READONLY_ALLOWLIST`; otherwise
     `throw new ForbiddenException('read-only admin cannot perform this action')`.
- **Guard order**: register `RolesGuard` as `APP_GUARD` immediately after
  `JwtAuthGuard` and before `ThrottlerGuard` in `admin.module.ts` providers.
  Nest runs global guards in registration order, so `req.user.role` is populated
  before `RolesGuard` reads it.
- **me()**: echo `role` from `req.user`; add `role: z.enum(ADMIN_ROLES)` to
  `MeResponseSchema`. Identity still comes from the request principal.
- Edge cases / DoS: default-deny by HTTP method means a NEW mutating admin route
  is automatically read-only-safe without remembering a decorator; the escape
  hatch (`@AllowReadOnly()`) is opt-in and greppable. Case-insensitive prefix +
  method match avoids the CWE-178 fail-open the JWT guard already documents. No
  extra DB hit, so no added login/DoS surface.

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=roles.guard.spec` passes: read-only is
      403'd on DELETE/POST/PATCH, allowed on GET and on the two allowlisted routes.
- [ ] A token signed while `role='admin'` is 403'd on a mutating route once the DB
      row is demoted to `readonly` (fresh-read case in the guard spec).
- [ ] `GET /api/admin/auth/me` response includes `role`; OpenAPI export
      (`me-response`) contains the `role` field.
- [ ] `nx test nestjs --testPathPattern=jwt-auth.guard.spec` still green with the
      attached-role assertion.

## Test obligations
- Unit: covered by [TEST-1002] cases 3–7.
- E2E: covered by [TEST-1002] cases 3–6 via HTTP.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3020].
