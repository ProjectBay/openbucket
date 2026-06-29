---
id: STORY-0415
title: Implement SPA routing and auth guards
epic: EPIC-05
status: done
size: S
risk: low
---

## User story
As an admin user, I want `/login`, `/force-rotate`, `/buckets`, `/buckets/:name`, `/buckets/:name/browse`, `/keys`, and `/settings` to be wired with `authGuard`, `unauthGuard`, and `mustNotRotateGuard`, so that unauthenticated users land on login and users with `mustChangePassword` are forced through password rotation before reaching the app shell.

## Description
Implement `apps/frontend/src/app/app.routes.ts` per §5.11 with the route tree: empty path redirects to `'buckets'`; `/login` lazy-loads `LoginComponent` behind `unauthGuard`; `/force-rotate` lazy-loads `ForceRotateComponent` behind `authGuard`; parent `''` route guards `[authGuard, mustNotRotateGuard]` lazy-loads `ShellComponent` and renders children `buckets`, `buckets/:name`, `buckets/:name/browse`, `keys`, `settings`. Wildcard `**` redirects to `'buckets'`. Implement the three `CanActivateFn` guards in `apps/frontend/src/app/auth/auth.guard.ts` exactly as in §5.11.

## Acceptance criteria
- [x] `app.routes.ts` matches §5.11 (path strings, guard arrays, lazy-load functions, wildcard).
- [x] `authGuard` returns `true` when `AuthService.isAuthenticated()`, otherwise `router.createUrlTree(['/login'])`.
- [x] `unauthGuard` is the inverse: redirects authenticated users to `/buckets`.
- [x] `mustNotRotateGuard` redirects to `/force-rotate` when `AuthService.mustChangePassword()` is true.
- [x] All routes use `loadComponent` (no eager imports of feature components).

## Tasks
- [TASK-1244] Implement `app.routes.ts` with lazy-loaded routes
- [TASK-1245] Implement `authGuard`, `unauthGuard`, `mustNotRotateGuard`
- [TASK-1246] Scaffold placeholder `LoginComponent`, `ForceRotateComponent`, `ShellComponent` stubs

## Test plan
- [TEST-0420] Auth guards unit spec

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0414], [STORY-0416] (`AuthService` signals)

## References
- `docs/WHITEPAPER.md` §5.11 (lines 7826–7927)
- Interfaces produced: `routes`, `authGuard`, `unauthGuard`, `mustNotRotateGuard`
- Interfaces consumed: `AuthService.isAuthenticated`, `AuthService.mustChangePassword` (STORY-0416)
