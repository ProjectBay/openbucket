---
id: TASK-1244
title: Implement app.routes.ts with lazy-loaded routes and guards
story: STORY-0415
status: done
type: implementation
size: S
---

## Description
Define the SPA route tree per §5.11 with `loadComponent` for every leaf and guards applied per route.

## Files to create / modify
- `apps/frontend/src/app/app.routes.ts` — modify (replace placeholder)

## Implementation notes
- Verbatim from §5.11 (lines 7833–7884):
  ```ts
  export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'buckets' },
    {
      path: 'login',
      canActivate: [unauthGuard],
      loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
    },
    {
      path: 'force-rotate',
      canActivate: [authGuard],
      loadComponent: () => import('./auth/force-rotate.component').then((m) => m.ForceRotateComponent),
    },
    {
      path: '',
      canActivate: [authGuard, mustNotRotateGuard],
      loadComponent: () => import('./shared/layout/shell.component').then((m) => m.ShellComponent),
      children: [
        { path: 'buckets', loadComponent: () => import('./buckets/bucket-list.component').then((m) => m.BucketListComponent) },
        { path: 'buckets/:name', loadComponent: () => import('./buckets/bucket-detail.component').then((m) => m.BucketDetailComponent) },
        { path: 'buckets/:name/browse', loadComponent: () => import('./objects/object-browser.component').then((m) => m.ObjectBrowserComponent) },
        { path: 'keys', loadComponent: () => import('./keys/keys-list.component').then((m) => m.KeysListComponent) },
        { path: 'settings', loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent) },
      ],
    },
    { path: '**', redirectTo: 'buckets' },
  ];
  ```

## Acceptance criteria
- [ ] Empty path redirects to `'buckets'`.
- [ ] `/login` guarded by `unauthGuard`; `/force-rotate` by `authGuard`.
- [ ] Parent `''` is guarded by `[authGuard, mustNotRotateGuard]`.
- [ ] Wildcard `**` redirects to `'buckets'`.

## Test obligations
- Unit: covered by [TEST-0420]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1242], [TASK-1245], [TASK-1246]

## References
- `docs/WHITEPAPER.md` §5.11 (lines 7826–7885)
