---
id: TASK-1812
title: Add a lazy NotFoundComponent and route `**` to it
story: STORY-0602
status: done
type: implementation
size: S
---

## Description
Replace the silent catch-all redirect with a real 404 page. Today `{ path: '**', redirectTo: 'buckets' }` sends any unknown URL to the bucket list, so a typo'd or stale link lands the admin on the wrong screen with no signal. Add a lazy `NotFoundComponent` and point `**` at it.

## Files to create / modify
- `apps/openbucket-frontend/src/app/not-found/not-found.component.ts` — new (`ob-not-found`, lazy)
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (route `**` to `NotFoundComponent`)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (404 copy keys)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (404 copy keys)

## Implementation notes
- Author `NotFoundComponent` as `selector: 'ob-not-found'`, `standalone: true`, `changeDetection: ChangeDetectionStrategy.OnPush`. Show a clear "page not found" message and a link home using `RouterLink` (`routerLink="/"`); style with `HlmButtonImports` (`import { HlmButtonImports } from '@openbucket/spartan-ui/button';`) for the link, matching the placeholder components' `class="p-6"` container convention.
- Use `TranslateModule` (`@ngx-translate/core`) and i18n keys (e.g. `notFound.title`, `notFound.message`, `notFound.backHome`) added to `en`/`de`, consistent with the existing `sidebar.*` key style.
- In `app.routes.ts` change the last route from `{ path: '**', redirectTo: 'buckets' }` to:
  ```ts
  { path: '**',
    loadComponent: () => import('./not-found/not-found.component').then((m) => m.NotFoundComponent) },
  ```
  Keep it as the final entry. Decide whether the 404 should render inside the shell (move it under the shell route's `children`, so it keeps the sidebar/header — likely preferred) or as a top-level bare page; if placed under the shell it should sit after the feature children. Whichever is chosen, it must not be `canActivate`-gated away for an authenticated admin.
- Do not reintroduce a redirect — the AC requires unknown routes to RENDER the 404, not bounce.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Visiting a bad URL (e.g. `/does-not-exist`) renders `NotFoundComponent` (not a redirect to `/buckets`); the page has a working link home.
- [ ] `grep -n "redirectTo: 'buckets'" app.routes.ts` no longer matches the `**` route.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0602] (a bad URL shows the 404).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1810]

## References
- UX review 2026-06-22 (IA lens F10 — `**` silently redirects unknown routes to buckets).
- `apps/openbucket-frontend/src/app/app.routes.ts` (line 59 `**` route), `apps/openbucket-frontend/src/app/home/home.component.ts` (component convention), `libs/ui/spartan/button/src/index.ts` (`HlmButtonImports`), `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`.
- Interfaces produced: `NotFoundComponent` (`ob-not-found`).
