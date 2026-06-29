---
id: TASK-1850
title: Seed palette groups from sidebarConfig + BucketsSignalStore; add Action items
story: STORY-0610
status: done
type: implementation
size: M
---

## Description
Populate the command palette with three groups: static navigation (from the sidebar nav config), a dynamic Buckets group (from the bucket store), and an Actions group (create bucket, create key, toggle theme). Selecting a nav/bucket item navigates; selecting an action runs it; the palette closes afterward.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/command-palette.component.ts` — modify (build the three groups + select handlers)

## Implementation notes
- Nav group: import `sidebarConfig` (and optionally `secondaryNavConfig`) from `layout/sidebar/data/sidebar.data.ts`. Each group is `{ groups: SidebarGroup[] }` and each `SimpleSidebarItem` has `{ id, title, icon, url }` (titles are i18n keys like `sidebar.workspace.home`). Map items with a `url` to `hlmCommandItem`s; on select `router.navigate([item.url])`. Render the title via the `translate` pipe (`@ngx-translate/core`).
- Buckets group: inject `BucketsSignalStore` (`buckets/buckets.signal-store.ts`); build a computed of its `items()` (`BucketSummaryDto.name`) into `hlmCommandItem`s that navigate to `/buckets/:name`. Trigger `store.refresh()` once so the group is populated. This is the dynamic group that makes the palette valuable for deep object paths.
- Actions group: `hlmCommandItem`s for "Create bucket" (open the bucket-create dialog / navigate, matching STORY-0603's create flow), "Create access key" (matching STORY-0611's create flow), and "Toggle theme". Theme toggle uses `AppearanceStore` (`core/platform/common/appearance/store/appearance.store.ts`): it exposes `theme: Signal<Theme>` (`'light' | 'dark' | 'system'`), `effectiveTheme: Signal<'light' | 'dark'>`, and `setTheme(theme: Theme): void` — toggle via `appearance.setTheme(appearance.effectiveTheme() === 'dark' ? 'light' : 'dark')`.
- Every select handler must close the palette (call `closePalette()` from TASK-1849) after acting.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] The palette shows a Nav group (from `sidebarConfig`), a dynamic Buckets group (from `BucketsSignalStore.items()`), and an Actions group (Create bucket / Create key / Toggle theme).
- [ ] Selecting a nav or bucket item navigates to the right route; "Toggle theme" flips `AppearanceStore` light↔dark; the create actions open the right flows.
- [ ] Selecting any item closes the palette.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0610] (groups populate; selection navigates/acts).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1849]

## References
- UX review 2026-06-22 (IA E/F6; power-user F).
- `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts` (`sidebarConfig`/`secondaryNavConfig`, `SimpleSidebarItem` `{id,title,icon,url}`), `buckets/buckets.signal-store.ts` (`BucketsSignalStore.items`/`refresh`), `core/platform/common/appearance/store/appearance.store.ts` (`AppearanceStore.theme`/`effectiveTheme`/`setTheme`), `@ngx-translate/core` (`translate`).
- Interfaces consumed: `BucketsSignalStore`, `AppearanceStore`, `sidebarConfig`.
