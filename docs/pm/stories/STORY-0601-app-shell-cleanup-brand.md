---
id: STORY-0601
title: App-shell cleanup, brand component & page-header unification
epic: EPIC-07
status: done
size: M
risk: low
---

## User story
As an admin, I want a coherent app shell — one product brand, consistent page titles/actions across shell variants, and no dead code — so the console feels finished and switching layouts doesn't change the hierarchy.

## Description
The `layout/shell/` tree is good but carries cruft: a dead parallel `shared/layout/{shell,sidenav,topbar}` (STORY-0415 placeholders, unreferenced), the brand block triplicated across the three sidebars with inconsistent casing ("Openbucket" vs "OpenBucket"), a page title that renders three different sizes/placements per variant (and drops the action button outside compact), a silently-missing Home icon (`lucideHouse` registered as `lucideHome`), and ~30 over-imported lucide icons for a 3-item sidebar.

## Acceptance criteria
- [ ] `shared/layout/{shell,sidenav,topbar}.component.ts` and the stale `app.routes.ts` comment are deleted; no broken references.
- [ ] A single `ob-brand` component (mark + wordmark, inline SVG using `currentColor`) replaces the triplicated brand in inset/sticky/compact sidebars; casing canonical "OpenBucket".
- [ ] All three shell variants render the page title through one path/size and render the `PageHeaderService` action button (not only compact).
- [ ] The Home/Dashboard sidebar icon renders; unused lucide icon registrations in `sidebar-renderer` are pruned.
- [ ] An account/identity menu (avatar + logout) is rendered in the sidebar footer using the already-imported `HlmDropdownMenuImports`.

## Tasks
- [TASK-1804] Delete `shared/layout/*` and the `app.routes.ts:29` comment; remove dead `ShellComponent` references.
- [TASK-1805] Create `layout/shell/components/brand.component.ts` (`ob-brand`); replace brand blocks in the three sidebars.
- [TASK-1806] Unify the page title: render via `ob-page-header` (or one heading size) in inset/sticky/compact; wire `PageHeaderService.setActionButton` to render in all variants; reconcile header heights.
- [TASK-1807] Fix the Home icon (register `lucideHouse` or change `sidebar.data.ts`); prune unused `provideIcons` in `sidebar-renderer.component.ts`.
- [TASK-1808] Add an account dropdown (`hlm-avatar` + `HlmDropdownMenu` + logout via `AuthService`) in the sidebar footer.

## Test plan
- [TEST-0601] E2E/manual: title + action render identically across the 3 shell variants; Home icon visible; logout works from the account menu; `nx build openbucket-frontend` has no unused-import/dead-file warnings.

## Dependencies
- Blocks: [STORY-0602], [STORY-0609]
- Blocked by: _none_

## References
- UX review 2026-06-22 (design lens F8/F9/F10/F12; IA lens F5/F11/F12).
- `apps/openbucket-frontend/src/app/layout/shell/**`, `shared/layout/**`, `layout/sidebar/{data,components}/**`, `layout/shell/services/page-header.service.ts`.
- Interfaces produced: `BrandComponent`; consumes `PageHeaderService`, `AuthService`.
