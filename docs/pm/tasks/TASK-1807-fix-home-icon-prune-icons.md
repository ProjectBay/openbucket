---
id: TASK-1807
title: Fix the Home sidebar icon and prune unused icon registrations
story: STORY-0601
status: done
type: refactor
size: XS
---

## Description
The Dashboard/Home sidebar item silently renders no icon because `sidebar.data.ts` references `icon: 'lucideHouse'` but `sidebar-renderer.component.ts` registers `lucideHome` (a different glyph name) and never registers `lucideHouse`. Fix the mismatch and prune the ~30 over-imported lucide icons in the renderer down to the set the sidebar config actually uses.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/sidebar/components/sidebar-renderer.component.ts` — modify (register `lucideHouse`; prune unused `provideIcons` entries + imports)

## Implementation notes
- `sidebar.data.ts` uses `icon: 'lucideHouse'` for the home item; the renderer's `provideIcons({ … })` block registers `lucideHome` (registered name `lucideHome`), so `<ng-icon [name]="item.icon" />` resolves nothing. Register `lucideHouse` (imported from `@ng-icons/lucide`) and remove `lucideHome`. (Confirmed: `lucideHouse` is a real `@ng-icons/lucide` export.)
- The renderer also references `lucideChevronDown` and `lucideChevronRight` directly in its template (the collapsible triggers), so those two must stay registered.
- Prune the rest: of the ~30 names in the `provideIcons({...})` block (`lucideHome, lucideLayout, lucideFlaskConical, lucideBookOpen, lucideFrame, lucideChartPie, lucideMap, lucideLifeBuoy, lucideSend, lucideEllipsis, lucideFolder, lucideShare, lucideTrash2, lucidePlus, lucideScissors, lucideLogIn, lucideShield, lucideUsers, lucideCreditCard, lucideBarChart, lucideBarChart3, lucideBuilding, lucideSettings, lucideFileText, lucideRoute, lucideMenu, lucideBlocks`), keep only icons whose names appear in the live sidebar configs. After STORY-0602's `sidebar.data.ts` rewrite the live set is the nav icons (`lucideLayoutDashboard`, `lucideDatabase`, `lucideKey`, `lucideSettings`) plus the template chevrons (`lucideChevronDown`, `lucideChevronRight`) and any account-menu icons added by [TASK-1808]. Drop all other registrations and their `@ng-icons/lucide` imports.
- Keep the registration set a superset of every `icon:` string in `sidebar.data.ts`/`secondaryNavConfig`; lint will not catch a missing-registration (it is a runtime no-render), so cross-check by reading the configs.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass with no unused-import warnings in `sidebar-renderer.component.ts`.
- [ ] The Dashboard/Home item renders a visible icon in the running app.
- [ ] Every `icon:` value in `sidebar.data.ts` has a matching `provideIcons` registration; no registered icon is unused.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0601] (Home/Dashboard icon visible).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1804]

## References
- UX review 2026-06-22 (design lens F11 — missing Home icon; F12 — over-imported icons).
- `apps/openbucket-frontend/src/app/layout/sidebar/components/sidebar-renderer.component.ts` (lines 6–36 imports, 59–91 `provideIcons`), `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts`.
