---
id: TASK-3023
title: Add the console admin-users screen and read-only gating
story: STORY-1002
status: backlog
type: implementation
size: M
---

## Description
Build the Angular console surface for multi-admin: a signals-based store over the
regenerated `AdminUsersService`, a list screen with create / edit-role /
reset-password / delete dialogs, a `/users` route restricted to full admins, and
console-wide read-only gating (hide/disable mutating controls). Server-side
`RolesGuard` remains authoritative — the UI gating is UX + defense-in-depth.

## Files to create / modify
- `apps/openbucket-frontend/src/app/users/admin-users.signal-store.ts` — new.
- `apps/openbucket-frontend/src/app/users/admin-users-list.component.ts` — new.
- `apps/openbucket-frontend/src/app/users/admin-user-create-dialog.component.ts` — new.
- `apps/openbucket-frontend/src/app/users/admin-user-edit-dialog.component.ts` — new (role select + reset password).
- `apps/openbucket-frontend/src/app/auth/auth.service.ts` — modify (`role` on `MeResponse`; `isReadOnly`/`isFullAdmin` computed signals).
- `apps/openbucket-frontend/src/app/auth/auth.guard.ts` — modify (add `fullAdminGuard` `CanActivateFn`).
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (add `/users` behind `[authGuard, mustNotRotateGuard, fullAdminGuard]`).
- `apps/openbucket-frontend/src/app/layout/**` — modify (sidebar entry gated on `isFullAdmin`).
- `apps/openbucket-frontend/src/assets/i18n/*.json` (or equivalent) — modify (users + roles strings).

## Implementation notes
- **Store** mirrors `keys/keys.signal-store.ts` (`@Injectable({ providedIn: 'root' })`,
  `_items`/`_loading`/`_error` signals, `refresh`/`create`/`update`/`remove`
  over `firstValueFrom(this.api.*)`). `api = inject(AdminUsersService)` from
  `@openbucket/api-client` (regenerated in [TASK-3024]).
- **auth.service** already has `mustChangePassword = computed(...)`; add `role`
  to the `MeResponse` interface and:
  ```ts
  readonly role = computed(() => this.me()?.role ?? null);
  readonly isFullAdmin = computed(() => this.me()?.role === 'admin');
  readonly isReadOnly = computed(() => this.me()?.role === 'readonly');
  ```
  These read from the existing in-memory `me` signal loaded by `loadMe()` — no
  new storage, token stays in-memory only (§5.12 posture preserved).
- **fullAdminGuard** (`CanActivateFn`, same shape as `mustNotRotateGuard`):
  inject `AuthService` + `Router`; `return auth.isFullAdmin() ? true : router.createUrlTree(['/'])`.
  Attach to the `/users` route after `authGuard`/`mustNotRotateGuard`.
- **List / dialogs**: reuse the keys-list + dialog components as the template
  (create dialog with username/password/role; edit dialog with role select and an
  optional reset-password field). Show the role as a badge. The 12-char password
  floor and username regex should be surfaced as client validation matching the
  [TASK-3022] zod schemas (server is the source of truth).
- **Read-only gating (defense in depth)**: gate mutating controls on
  `!auth.isReadOnly()` — e.g. the create/delete buttons on keys, buckets, objects,
  backup-restore, and the whole `/users` nav entry. A read-only admin still sees
  data (all GETs succeed) but the actions are hidden/disabled; the server still
  returns 403 if a mutating call is forced, so this is purely UX.
- Edge cases: a read-only user who deep-links to `/users` is redirected by
  `fullAdminGuard`; a user demoted mid-session sees the change after the next
  `loadMe()`/refresh (token also re-derives `role` on refresh per [TASK-3021]).
  Do not render `passwordHash` (the summary DTO doesn't carry it).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `nx test openbucket-frontend --testPathPattern=admin-users` covers the store
      CRUD and the read-only-hides-controls behaviour.
- [ ] Logged in as a read-only admin: the `/users` nav item is absent, deep-linking
      to `/users` redirects to `/`, and create/delete buttons are not rendered.
- [ ] Logged in as a full admin: can create, change a peer's role, reset a peer's
      password, and delete a peer from the console end to end.

## Test obligations
- Unit: covered by [TEST-1002] case 15 (store + guard specs).
- E2E: covered by [TEST-1002] case 15 (console flow).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3022], [TASK-3024].
