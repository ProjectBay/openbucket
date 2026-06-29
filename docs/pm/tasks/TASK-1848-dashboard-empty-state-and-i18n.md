---
id: TASK-1848
title: Dashboard empty state (hlm-empty) + dashboard i18n keys
story: STORY-0609
status: done
type: implementation
size: S
---

## Description
Add an empty state to the dashboard for a fresh instance with no buckets — an `hlm-empty` block with a short message and a "Create bucket" CTA — and localize the dashboard's strings (tile labels, card titles, quick-action labels, empty state) into the en/de dictionaries.

## Files to create / modify
- `apps/openbucket-frontend/src/app/home/home.component.ts` — modify (empty-state branch + `translate` pipe)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add `dashboard` namespace)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (mirror keys, German values)

## Implementation notes
- Empty state: import `HlmEmptyImports` from `@openbucket/spartan-ui/empty` (`HlmEmpty`/`HlmEmptyHeader`/`HlmEmptyMedia`/`HlmEmptyTitle`/`HlmEmptyDescription`/`HlmEmptyContent`). Show it when `!store.loading() && store.count() === 0`: a title, a one-line description, and a "Create bucket" `hlmBtn` CTA reusing the create-bucket flow (TASK-1846/1847). When buckets exist, render the tiles + cards instead.
- i18n: translations are nested objects exported `default` from `i18n/{en,de}.translations.ts`, loaded via the `InMemoryTranslateLoader` in `app.config.ts` and consumed through the `@ngx-translate/core` `translate` pipe (dotted keys like `sidebar.workspace.label`). Add a sibling `dashboard` namespace, e.g. `dashboard: { title, subtitle, tiles: { buckets, objects, size }, recent: { title, empty }, actions: { title, createBucket, createKey }, empty: { title, description, cta } }`, and replace the hard-coded English in the template with `{{ 'dashboard.…' | translate }}`.
- Provide real German values in `de.translations.ts` (no English placeholders); keep the key set identical across en/de.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] On a fresh instance (no buckets) the dashboard shows an `hlm-empty` state with a "Create bucket" CTA instead of empty/zeroed tiles.
- [ ] `en.translations.ts` and `de.translations.ts` both carry a parallel `dashboard` namespace; the template strings render via the `translate` pipe.
- [ ] Switching to `de` localizes the dashboard.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0609] (empty state on fresh instance; locale spot check).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1845], [TASK-1846]

## References
- UX review 2026-06-22 (IA B/F2 — empty/onboarding state; localization).
- `apps/openbucket-frontend/src/app/home/home.component.ts`, `i18n/{en,de}.translations.ts`, `app.config.ts` (`InMemoryTranslateLoader`), `@ngx-translate/core` (`translate` pipe), `libs/ui/spartan/{empty,button}`.
