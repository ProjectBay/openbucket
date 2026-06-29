---
id: TASK-1872
title: Re-link bucket-list name → `/buckets/:name`, add status badges + i18n keys
story: STORY-0613
status: done
type: implementation
size: S
---

## Description
Point the bucket-list name link at the new detail page (`/buckets/:name`) instead of jumping straight to `…/browse`, and add at-a-glance status badges (versioning / object-lock) to the list rows. Add the i18n keys for the new bucket-detail tab labels and the list badges.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (route link + status badges)
- `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` — modify only if tab labels need i18n keys added here
- the frontend i18n message catalog(s) — modify (new keys for tab labels + list badges; locate via the existing locale store / message files under `core/platform/common/locale`)

## Implementation notes
- Re-link: change `[routerLink]="['/buckets', b.name, 'browse']"` to `[routerLink]="['/buckets', b.name]"` in `bucket-list.component.ts` (line ~47). The Objects tab inside the detail page then deep-links to `…/browse` (wired in [TASK-1867]). Confirm the `app.routes.ts` `buckets/:name` route resolves to the new tabbed `BucketDetailComponent`.
- Status badges: `import { HlmBadgeImports } from '@openbucket/spartan-ui/badge';` (mirror `layout/sidebar/components/sidebar-renderer.component.ts`). The list summary (`BucketSummaryDto`) already carries `versioning` (`'disabled'|'enabled'|'suspended'`) and `objectLock` (boolean) — render a "Versioning: Enabled/Suspended" badge and an "Object Lock" badge from the existing list data (no new fetch).
- i18n: follow the existing locale/message-key convention (the `LocaleService`/`LocaleStore` under `core/platform/common/locale`). Add keys for the eight tab labels (Objects/Properties/Versioning/Encryption/Tags/Lifecycle/CORS/Policy) and the list badges, in every locale file the repo ships.
- Build on **Node 23** (`[[project_frontend_node23_build]]`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) pass.
- [ ] Clicking a bucket name in the list navigates to `/buckets/:name` (the tabbed detail), not `…/browse`.
- [ ] List rows show versioning + object-lock badges sourced from `BucketSummaryDto` (no extra request).
- [ ] Tab labels + list badges resolve via i18n keys in every shipped locale (no hardcoded English).

## Test obligations
- Unit: covered by [TEST-0613] (link target + badge rendering, if harness wired).
- E2E: covered by [TEST-0613] (list → detail navigation + badges).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1867] (the detail route must resolve to the tabbed page)

## References
- UX review 2026-06-22 (IA D/F3/F4 — list links to detail; status at a glance).
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` (the `…/browse` link + `BucketSummaryDto` fields), `app.routes.ts` (`buckets/:name`), `libs/ui/spartan/badge`, `core/platform/common/locale` (i18n keys), `layout/sidebar/components/sidebar-renderer.component.ts` (badge import example).
- See `[[project_frontend_node23_build]]`.
