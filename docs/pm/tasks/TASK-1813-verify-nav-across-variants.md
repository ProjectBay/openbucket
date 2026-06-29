---
id: TASK-1813
title: Verify nav + breadcrumbs render across inset, sticky and compact
story: STORY-0602
status: done
type: implementation
size: XS
---

## Description
Confirm the new domain nav and breadcrumb behaviour render correctly in all three shell variants. All three sidebars consume the same `sidebarConfig` via `ob-sidebar-renderer`, and all three headers consume the same `BreadcrumbService`, so a single config/service change should surface everywhere — this task verifies that and fixes any variant-specific gaps (e.g. a variant whose `secondaryConfig` binding broke when the Help item was removed in [TASK-1809]).

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/inset/components/inset-sidebar.component.ts` — modify only if a variant-specific gap is found
- `apps/openbucket-frontend/src/app/layout/shell/sticky/components/sticky-sidebar.component.ts` — modify only if a variant-specific gap is found
- `apps/openbucket-frontend/src/app/layout/shell/compact/components/compact-sidebar.component.ts` — modify only if a variant-specific gap is found

## Implementation notes
- All three sidebars bind `protected readonly mainConfig = sidebarConfig;` and (inset/sticky) `secondaryConfig = secondaryNavConfig;` from `sidebar.data.ts`; compact renders `secondaryConfig` in its `<hlm-sidebar-footer>`. If [TASK-1809] emptied or removed `secondaryNavConfig`, ensure each variant still compiles and renders (empty group renders nothing — that is fine).
- The shell variant is chosen at runtime by `ShellLayoutService.variant()` in `DynamicShellLayout` (`'inset' | 'sticky' | 'compact'`). Exercise each by switching the appearance/variant in the running app (`nx serve openbucket-frontend`) and confirm: the four nav items appear and route; the breadcrumb shows the bucket name on a deep URL; the 404 renders for a bad URL.
- This is primarily a verification task; only edit a sidebar component if a variant diverges (no new components). Keep the change set minimal.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] In inset, sticky and compact: the Dashboard/Buckets/Keys/Settings nav renders and routes; the breadcrumb shows the real bucket name on `/buckets/:name/...`; an unknown URL shows the 404.
- [ ] No variant-specific regression (each variant compiles and renders the shared config).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0602] (nav + breadcrumb render across all three variants).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1809], [TASK-1811], [TASK-1812]

## References
- UX review 2026-06-22 (IA lens F1/F2/F9/F10 — verify the fixes across shell variants).
- `apps/openbucket-frontend/src/app/layout/shell/{inset,sticky,compact}/components/*-sidebar.component.ts`, `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts`, `apps/openbucket-frontend/src/app/layout/shell/services/shell-layout.service.ts`.
