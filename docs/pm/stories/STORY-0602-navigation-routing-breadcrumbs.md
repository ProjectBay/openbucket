---
id: STORY-0602
title: Domain navigation, routing, breadcrumbs & 404 page
epic: EPIC-07
status: done
size: M
risk: low
---

## User story
As an admin, I want the sidebar and breadcrumbs to map to what I manage (Dashboard, Buckets, Access Keys, Settings) with shareable URLs and a real not-found page, so I can reach any area in one click and never silently land on the wrong screen.

## Description
The sidebar lists only "Home" and "Settings" plus a dead `#` Help item — Buckets and Keys, the primary destinations, are absent. "Home" links to `/` which `redirectTo: 'buckets'` (no `home` route exists, so `HomeComponent` is dead). Breadcrumbs auto-title-case raw segments and drop dynamic `:name` values ("Buckets › Browse"), and `**` silently redirects unknown routes to buckets.

## Acceptance criteria
- [ ] `sidebar.data.ts` lists Dashboard (`/`), Buckets (`/buckets`), Access Keys (`/keys`), Settings — with i18n keys; the dead `#` Help item is removed.
- [ ] A `home` index route resolves to `HomeComponent` (no longer dead).
- [ ] Breadcrumbs show the real bucket name and meaningful labels (e.g. "Buckets › my-bucket › Objects") via route `data: { breadcrumb }` or a `:name` resolver.
- [ ] Unknown routes render a lazy `NotFoundComponent` (not a silent redirect), with a link home.
- [ ] All three shell variants render the new nav from the shared config.

## Tasks
- [TASK-1809] Rewrite `layout/sidebar/data/sidebar.data.ts` (Storage group: Dashboard/Buckets/Keys + Settings) with `lucideLayoutDashboard`/`lucideDatabase`/`lucideKey`; add `i18n/{en,de}.translations.ts` keys.
- [TASK-1810] Add the `home` index child route in `app.routes.ts`; keep guards/redirect-after-login.
- [TASK-1811] Add `data: { breadcrumb }` / a `:name` resolver on the bucket routes; fix `BreadcrumbService` dynamic-segment handling.
- [TASK-1812] Add `not-found.component.ts` (lazy) and route `**` to it instead of `redirectTo`.
- [TASK-1813] Verify nav + breadcrumb render across inset/sticky/compact.

## Test plan
- [TEST-0602] E2E/manual: each nav item routes correctly; deep bucket URL shows the bucket name in the breadcrumb; a bad URL shows the 404; Dashboard nav resolves.

## Dependencies
- Blocks: [STORY-0609], [STORY-0610], [STORY-0613]
- Blocked by: [STORY-0601]

## References
- UX review 2026-06-22 (IA lens F1/F2/F9/F10).
- `apps/openbucket-frontend/src/app/app.routes.ts`, `layout/sidebar/data/sidebar.data.ts`, `layout/shell/services/breadcrumb.service.ts`, `home/home.component.ts`.
