---
id: TASK-1873
title: Add a Versions tab to the object sheet bound to the versions endpoint
story: STORY-0614
status: done
type: implementation
size: M
---

## Description
Add a Versions tab to the object detail `HlmSheet` (built in STORY-0604) that lists an object's versions and delete markers for versioning-enabled buckets. The tab reads from the new `listObjectVersions` admin endpoint exposed via `@openbucket/api-client` (STORY-0612) and shows id, size, lastModified, and an "isLatest" indicator per row. Row actions (Download/Delete) are added by TASK-1874; this task lands the tab shell, data binding, and empty/loading/error states.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (add a Versions tab inside the detail `HlmSheet`; signal + load for versions)
- `apps/openbucket-frontend/src/app/objects/object-versions.component.ts` — new (standalone, OnPush component rendering the versions table)

## Implementation notes
- The current detail panel is the inline `<aside>` in `object-browser.component.ts` (lines 86–127); STORY-0604 moves it into an `HlmSheet`. Add the Versions table there as a tabbed section using `HlmTabsImports` (`@openbucket/spartan-ui/tabs`) with a "Details" tab (existing `<dl>`) and a "Versions" tab.
- Table built on `HlmTableImports` (`@openbucket/spartan-ui/table`) to match the rebuilt object table; columns: Version (mono, truncated, with `CopyButtonComponent` from TASK-1802), Size (`| byteSize`, right-aligned), Modified (`| relativeTime`), Latest badge (`HlmBadge` from `@openbucket/spartan-ui/badge`). Delete markers render with a `lucideTrash2`/`lucideMinus` indicator and no size.
- Call the generated client method `ObjectsAdminService.listObjectVersions(name, path, ...)` (added by STORY-0612 / TASK-1861). Per STORY-0612 the response is `listObjectVersions` shaped; bind to a typed `ObjectVersion[]`/delete-marker DTO from `@openbucket/api-client` once regenerated. Use `firstValueFrom(...)` like the existing `getObject`/`listObjects` calls.
- Hold versions in `readonly versions = signal<ObjectVersion[]>([])` plus `versionsLoading`/`versionsError` signals; load lazily when the Versions tab is first opened (do not block the Details tab). Use `OnPush` and `@for (v of versions(); track v.versionId)`.
- Empty state when the bucket is unversioned or the list is empty: show "No versions" (i18n key from TASK-1877), not a blank table. Surface list errors with `notify.error(...)` (TASK-1800) — do NOT swallow in `try/finally` (matches STORY-0604 AC).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23 for the frontend).
- [ ] Opening the Versions tab on a versioning-enabled bucket lists versions + delete markers with id/size/lastModified and a Latest indicator.
- [ ] An unversioned bucket / empty list shows the empty state, not an error or blank table; a list failure shows an error toast.
- [ ] Versions load lazily and do not block the Details tab; component is `OnPush` with `@for ... track`.

## Test obligations
- Unit: covered by [TEST-0614] (versions signal binds list; empty state when absent).
- E2E: covered by [TEST-0614] (manual/e2e on a versioning-enabled bucket).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user E; feature-gap table — versions UI absent).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (detail panel lines 86–127), `libs/ui/spartan/{tabs,table,badge}`, `libs/api-client/src/lib/api/objects-admin.service.ts` (`listObjectVersions`, added by STORY-0612).
- Interfaces consumed: `ObjectsAdminService.listObjectVersions` + version DTO (STORY-0612), `CopyButtonComponent` (TASK-1802), `notify` (TASK-1800).
