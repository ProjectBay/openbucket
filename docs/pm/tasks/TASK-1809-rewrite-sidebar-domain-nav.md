---
id: TASK-1809
title: Rewrite the sidebar config to the real domain nav with i18n keys
story: STORY-0602
status: done
type: implementation
size: S
---

## Description
Replace the placeholder sidebar (Home + Settings + a dead `#` Help item) with the real management destinations: Dashboard, Buckets, Access Keys, and Settings. The primary destinations (Buckets, Keys) are currently absent from the nav entirely. Add the matching i18n keys for English and German.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts` — modify (rewrite `sidebarConfig`; remove the dead Help item)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add nav labels)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (add nav labels)

## Implementation notes
- Build the config with the existing `createSidebarConfig` builder (`createSidebarConfig.group({...})` / `createSidebarConfig.item({...})` from `../types`). Replace the current `workspace` group's two items with a Storage group containing four items:
  - Dashboard → `icon: 'lucideLayoutDashboard'`, `url: '/'`
  - Buckets → `icon: 'lucideDatabase'`, `url: '/buckets'`
  - Access Keys → `icon: 'lucideKey'`, `url: '/keys'`
  - Settings → `icon: 'lucideSettings'`, `url: '/settings'`
  (All four icon names are real `@ng-icons/lucide` exports; `lucideSettings` is already registered in the renderer.)
- Each item's `title` must be an i18n key (the renderer pipes it through `| translate`), e.g. `sidebar.storage.label`, `sidebar.storage.dashboard`, `sidebar.storage.buckets`, `sidebar.storage.keys`, `sidebar.storage.settings`. Keep keys consistent across `en`/`de`.
- Remove `secondaryNavConfig`'s dead Help item (`id: 'help'`, `url: '#'`, `icon: 'lucideLifeBuoy'`). If that leaves `secondaryNavConfig` empty, either delete the export and its usages in the three sidebars' `secondaryConfig` bindings, or leave it as an empty `{ groups: [] }` — pick one and keep the three sidebar components consistent.
- The `'/'` Dashboard link depends on the `home` index route added by [TASK-1810]; coordinate so the Dashboard item is not active-highlighted for every child route (the renderer uses `[routerLinkActiveOptions]="{ exact: false }"`, so `/` would match everything — set `exact: true` for the Dashboard item or route it to an explicit path).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] The sidebar lists Dashboard, Buckets, Access Keys, Settings (in that order) with translated labels in `en` and `de`; the `#` Help item is gone.
- [ ] Each new item routes to its `url` and the new icon names have registrations (see [TASK-1807]).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0602] (each nav item routes correctly).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0601]

## References
- UX review 2026-06-22 (IA lens F1 — primary destinations missing from nav; F2 — dead `#` Help item).
- `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts`, `apps/openbucket-frontend/src/app/layout/sidebar/types/index.ts` (`createSidebarConfig`), `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`.
- Interfaces produced: `sidebarConfig` (consumed by the inset/sticky/compact sidebars).
