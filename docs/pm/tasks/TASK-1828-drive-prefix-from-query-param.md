---
id: TASK-1828
title: Drive `prefix` from a `?prefix=` query param (deep-link + history)
story: STORY-0605
status: done
type: implementation
size: M
---

## Description
Make the current folder live in the URL so back/forward, bookmarking, and refresh all work. The browser currently keeps `(prefix, marker)` in an in-memory stack that resets on refresh and never writes the folder to the URL. Bind `prefix` from a `?prefix=` query param (component-input-binding is already enabled in `app.config.ts`), `router.navigate` when drilling into a folder so a real history entry is pushed, and seed the initial listing from the URL.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (query-param input, `router.navigate` on folder open, seed from URL)

## Implementation notes
- `app.config.ts` already calls `provideRouter(appRoutes, withComponentInputBinding())`, so a router-supplied input named `prefix` will receive the `?prefix=` query param. Add `@Input() set prefixParam(value: string | undefined)` (or an `input()` named to match the query key) that calls `void this.navigateTo(value ?? '')`; with component-input-binding the query param flows in on navigation AND on refresh.
- Replace the direct `openFolder(commonPrefix)` → `navigateTo(...)` call with a `router.navigate([], { relativeTo: route, queryParams: { prefix: commonPrefix }, queryParamsHandling: 'merge' })` so a real history entry is pushed (browser Back then returns to the previous folder). Inject `Router`.
- In `ngOnInit`, drop the unconditional `void this.navigateTo('')`; instead seed from `this.route.snapshot.queryParamMap.get('prefix') ?? ''` (the input setter will also fire). Keep `bucket` seeded from `paramMap.get('name')`.
- Leave the marker/`nextMarker` paging stack in memory (a single page's marker is not bookmarkable); only the `prefix` is URL-addressable. Changing prefix already resets the stack in `navigateTo`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Drilling into a folder updates the URL to `...?prefix=<folder>/` and pushes a history entry; browser Back returns to the parent folder.
- [ ] Refreshing on a `?prefix=` URL restores the same folder listing.
- [ ] A bookmarked/shared `?prefix=` URL opens directly into that folder.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0605] (deep-link a folder: bookmark + refresh + browser Back).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604]

## References
- UX review 2026-06-22 (IA C — folder not in URL; F7 — bookmark/refresh/Back broken).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (`ngOnInit`, `navigateTo`, `openFolder`, `stack`), `apps/openbucket-frontend/src/app/app.config.ts` (`withComponentInputBinding`), `@angular/router` (`Router`, `ActivatedRoute`).
