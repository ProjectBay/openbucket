---
id: TASK-1877
title: i18n keys + empty states for versions/tags/retention
story: STORY-0614
status: done
type: implementation
size: S
---

## Description
Add translation keys for every user-facing string introduced by the Versions/Tags/Retention UI (TASK-1873..1876) to `en.translations.ts` and `de.translations.ts`, and add explicit empty states for each section (no versions, no tags, no metadata, object-lock disabled) so absent features never render as a blank table or error.

## Files to create / modify
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add an `objects.versions` / `objects.tags` / `objects.retention` key group)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (mirror the new keys)
- `apps/openbucket-frontend/src/app/objects/object-versions.component.ts` — modify (use keys + empty state)
- `apps/openbucket-frontend/src/app/objects/object-tags.component.ts` — modify (use keys + empty state)
- `apps/openbucket-frontend/src/app/objects/object-retention.component.ts` — modify (use keys + empty state)

## Implementation notes
- The translation files are a nested default-export object (existing top-level key: `sidebar`). Add a sibling `objects` group, e.g. `objects: { versions: { title, latest, deleteMarker, empty, download, delete, ... }, tags: { title, addTag, key, value, metadataReadOnly, empty, save }, retention: { title, mode, governance, compliance, retainUntil, legalHold, complianceReadOnly, lockDisabled } }`. Keep both `en` and `de` shapes identical (same key paths) — the German file must mirror exactly.
- Components import `TranslateModule` (`@ngx-translate/core`) and use the `| translate` pipe, matching how the shell headers already do it (e.g. `page-header.component.ts`: `{{ pageHeader.pageTitle() | translate }}`). No hardcoded English literals in the new templates — this is enforced by STORY-0617.
- Empty states: each section renders a muted "empty" message (its own key) rather than an empty table/`<dl>` when the data is absent — Versions empty (`objects.versions.empty`), no tags, no `userMetadata`, and object-lock disabled (`objects.retention.lockDisabled`).
- Confirm/toast strings raised by TASK-1874/1875/1876 also get keys here (delete-version confirm, tags-saved toast, etc.).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Every string in the versions/tags/retention UI resolves through a translation key; `de` shows German when the locale is switched.
- [ ] `en.translations.ts` and `de.translations.ts` have identical key paths for the new `objects` group (no missing keys).
- [ ] Each section shows its empty state (not a blank table or thrown error) when the underlying data is absent.

## Test obligations
- Unit: covered by [TEST-0614] (empty-state rendering when data absent).
- E2E: covered by [TEST-0614] (manual: switch to `de`, strings translate).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1873], [TASK-1874], [TASK-1875], [TASK-1876]

## References
- UX review 2026-06-22 (power-user E; cross-cutting i18n note — feature screens hardcode English).
- `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`, `apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts` (translate-pipe pattern).
- Related: [STORY-0617] (i18n completeness convention).
