---
id: TASK-1810
title: Add the `home` index child route so `HomeComponent` is reachable
story: STORY-0602
status: done
type: implementation
size: XS
---

## Description
Wire `HomeComponent` to the shell index so the Dashboard nav item resolves to a real component. Today `path: ''` under the shell does `redirectTo: 'buckets'`, there is no `home`/index route, and `HomeComponent` (`home/home.component.ts`) is dead code that nothing loads.

## Files to create / modify
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (add an index child route loading `HomeComponent`)

## Implementation notes
- In `appRoutes`, the shell route is `{ path: '', canActivate: [authGuard, mustNotRotateGuard], loadComponent: () => import('./layout').then((m) => m.DynamicShellLayout), children: [...] }`. Add an index child so `/` (inside the shell) renders the dashboard:
  ```ts
  { path: '', pathMatch: 'full',
    loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent) },
  ```
  Add it as the first entry in the shell's `children` array (alongside `buckets`, `buckets/:name`, `keys`, `settings`).
- Decide on the top-level `{ path: '', pathMatch: 'full', redirectTo: 'buckets' }` (line 11). With a shell index child for `/`, that top-level redirect should be removed (or changed to not redirect away from the dashboard) so the Dashboard nav `url: '/'` lands on `HomeComponent` instead of bouncing to `/buckets`. Keep the existing guards (`authGuard`, `mustNotRotateGuard`) and the login redirect untouched.
- Do not change `AuthService.login()`'s post-login `this.router.navigate(['/buckets'])` — that is an explicit destination, not the index route, and is out of scope here.
- `HomeComponent` already calls `PageHeaderService.setPageHeader('Dashboard', 'Your workspace overview')` in its constructor, so the unified header (TASK-1806) will pick up its title automatically.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Navigating to `/` renders `HomeComponent` within the shell (no longer redirects to `/buckets`); the Dashboard nav item resolves.
- [ ] `grep -rn "HomeComponent" apps/openbucket-frontend/src/app/app.routes.ts` shows the new lazy import.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0602] (Dashboard nav resolves).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1809]

## References
- UX review 2026-06-22 (IA lens F9 — Home links to `/` which redirects to buckets, `HomeComponent` dead).
- `apps/openbucket-frontend/src/app/app.routes.ts` (lines 11, 25–57), `apps/openbucket-frontend/src/app/home/home.component.ts` (`HomeComponent`).
