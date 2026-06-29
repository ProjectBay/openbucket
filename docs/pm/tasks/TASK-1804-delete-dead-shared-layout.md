---
id: TASK-1804
title: Delete the dead `shared/layout/*` tree and the stale shell comment
story: STORY-0601
status: done
type: refactor
size: XS
---

## Description
Remove the unreferenced `shared/layout/{shell,sidenav,topbar}.component.ts` placeholders (STORY-0414/0415 scaffolds) and the stale STORY-0415 comment in `app.routes.ts`. The real shell is `DynamicShellLayout` (`./layout`); nothing imports `ShellComponent`, `sidenav.component.ts`, or `topbar.component.ts` anymore, so they are pure cruft.

## Files to create / modify
- `apps/openbucket-frontend/src/app/shared/layout/shell.component.ts` — delete
- `apps/openbucket-frontend/src/app/shared/layout/sidenav.component.ts` — delete
- `apps/openbucket-frontend/src/app/shared/layout/topbar.component.ts` — delete
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (drop the dead-code comment on the shell route)

## Implementation notes
- `shell.component.ts` declares `export class ShellComponent {}` (`selector: 'ob-shell'`); `sidenav.component.ts` and `topbar.component.ts` are bare `export {};` placeholders. A repo-wide search for `shared/layout` and `ShellComponent` finds only the files themselves plus the comment — no live importer.
- In `app.routes.ts` the shell route loads the real shell: `loadComponent: () => import('./layout').then((m) => m.DynamicShellLayout)`. Remove only the two stale comment lines above it:
  - `// Real app shell (sidebar + header, variant-switchable via AppearanceStore)`
  - `// instead of the STORY-0415 placeholder ShellComponent.`
- Do not touch the route table itself in this task (route changes belong to STORY-0602). After deletion the `shared/layout` directory should be empty — remove the directory too if the tooling leaves it.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] The three `shared/layout/*.component.ts` files no longer exist; `grep -r "shared/layout"` and `grep -r "ShellComponent"` over `apps/openbucket-frontend/src` return no hits.
- [ ] The STORY-0415 comment is gone from `app.routes.ts`.

## Test obligations
- Unit: N/A (deletion).
- E2E: covered by [TEST-0601] (no broken references / build clean).
- Conformance: N/A.

## Dependencies
- Blocked by: _none_

## References
- UX review 2026-06-22 (design lens F12 — dead parallel layout tree).
- `apps/openbucket-frontend/src/app/shared/layout/{shell,sidenav,topbar}.component.ts`, `apps/openbucket-frontend/src/app/app.routes.ts` (lines 28–30), `apps/openbucket-frontend/src/app/layout/index.ts` (`DynamicShellLayout`).
