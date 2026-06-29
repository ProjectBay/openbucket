---
id: TASK-1867
title: Build the bucket-detail tabbed shell (`HlmTabs` + `?tab=` deep-link + `setHasTabs`)
story: STORY-0613
status: done
type: implementation
size: M
---

## Description
Replace the "Coming soon" placeholder `bucket-detail.component.ts` with a real tabbed page: a tab bar (Objects, Properties, Versioning, Encryption, Tags, Lifecycle, CORS, Policy) over `HlmTabs`, honoring `AppearanceStore.tabsVariant`, with the active tab bound to a `?tab=` query param so tabs are deep-linkable and back/forward works. The individual panel bodies land in [TASK-1868..1871]; this Task delivers the shell, the route param plumbing, and the page-header wiring.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` — replace the placeholder
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.spec.ts` — new (shell/tab-deep-link cases under [TEST-0613] if the frontend jest harness is wired)

## Implementation notes
- Read the bucket name from the route: the route is `buckets/:name` (`app.routes.ts`), so `inject(ActivatedRoute).snapshot.paramMap.get('name')` (or the param signal). Detail is reached via the bucket list (re-linked in [TASK-1872]).
- Tabs via spartan: `import { HlmTabsImports } from '@openbucket/spartan-ui/tabs';` (exports `[HlmTabs, HlmTabsList, HlmTabsTrigger, HlmTabsContent, HlmTabsPaginatedList]`). Mirror an existing usage of the spartan import-array pattern (`HlmBadgeImports` in `layout/sidebar/components/sidebar-renderer.component.ts`).
- `AppearanceStore.tabsVariant` is `'default' | 'line'` (`core/platform/common/appearance/store/appearance.store.ts`); read it (`inject(AppearanceStore).tabsVariant()`) and pass it to the tabs styling/variant input so the page honors the user's tabs preference.
- `?tab=` deep-link: the active tab id is the source of truth in the URL. On init, read `?tab=` (default `objects`); on tab change, `router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' })` so back/forward navigates tabs. Tab ids: `objects`, `properties`, `versioning`, `encryption`, `tags`, `lifecycle`, `cors`, `policy`.
- Page header: call `inject(PageHeaderService).setHasTabs(true)` on init and `setHasTabs(false)` on destroy (or set the bucket name as the page title via `setPageHeader(name, ...)`). `PageHeaderService` is in `layout/shell/services/page-header.service.ts`.
- Objects tab is the default and hosts/links the object browser — [TASK-1868] fills Properties/Versioning/Encryption; this Task wires the Objects tab to deep-link to `buckets/:name/browse` (the existing `ObjectBrowserComponent` route).
- Standalone component (`standalone: true`), `imports: [CommonModule, RouterLink, ...HlmTabsImports]`. Build on **Node 23** (Angular build fails on Node 20 — `[[project_frontend_node23_build]]`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) pass.
- [ ] Navigating to `/buckets/<name>` shows the tab bar with all eight tabs; the bar uses `AppearanceStore.tabsVariant` (verify `line` vs `default` visually).
- [ ] `/buckets/<name>?tab=versioning` opens directly on the Versioning tab; switching tabs updates `?tab=`; browser back/forward navigates between tabs.
- [ ] `PageHeaderService.hasTabs()` is `true` while the page is active.

## Test obligations
- Unit: covered by [TEST-0613] (shell + deep-link, if the frontend jest harness is wired; else build-verified + manual).
- E2E: covered by [TEST-0613] (manual/Playwright tab navigation).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0602] (app shell + page header), [STORY-0612] (the admin endpoints the panels consume)

## References
- UX review 2026-06-22 (power-user D; IA D/F3/F4 — bucket-detail tabs).
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` (placeholder), `app.routes.ts` (`buckets/:name`, `buckets/:name/browse`), `libs/ui/spartan/tabs` (`HlmTabsImports`), `core/platform/common/appearance/store/appearance.store.ts` (`tabsVariant`), `layout/shell/services/page-header.service.ts` (`setHasTabs`), `layout/sidebar/components/sidebar-renderer.component.ts` (spartan import-array example).
- See `[[project_frontend_node23_build]]`.
