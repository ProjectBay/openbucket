---
id: TASK-1890
title: Provide German translations and prune stale keys
story: STORY-0617
status: done
type: implementation
size: S
---

## Description
Mirror every key added to `en.translations.ts` (TASK-1889/1891 and the rebuilt-screen stories) into `de.translations.ts` with German strings, and prune stale keys that no longer map to a real screen so the two files stay in lockstep.

## Files to create / modify
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (add German for all new keys; remove stale keys)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (remove the matching stale keys)

## Implementation notes
- Both files are nested default-export objects with identical shape; `de` must mirror `en` key-for-key (the `InMemoryTranslateLoader` in `app.config.ts` picks `de` vs `en` by language). A missing `de` key silently falls back to the key string, so every `en` key needs a `de` counterpart.
- Provide idiomatic German for the new `buckets`/`objects`/`keys`/`auth`/`settings` groups and the shared-primitive group (TASK-1891), following the existing `sidebar` translations (e.g. `Workspace`→`Arbeitsbereich`, `Settings`→`Einstellungen`, `Help`→`Hilfe`).
- Stale keys: `sidebar.content.pages` ("Pages"/"Seiten") and `sidebar.content.routes` ("Routes"/"Routen") correspond to demo pages that do not exist in the app; remove them from BOTH files (and any sidebar config referencing them). Re-audit for any other key with no template consumer.
- After pruning, the set of keys in `en` must exactly equal the set in `de`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `de.translations.ts` covers every key in `en.translations.ts` (identical key sets — verified by a diff of flattened key paths).
- [ ] The stale `sidebar.content.pages` / `sidebar.content.routes` keys (and any other dead keys) are removed from both files.
- [ ] Switching the locale to `de` shows German across the (re)built screens.

## Test obligations
- Unit: covered by [TEST-0617] (en/de key-set equality).
- E2E: covered by [TEST-0617] (manual: locale=de walk-through).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1889]

## References
- UX review 2026-06-22 (cross-cutting i18n — stale keys for non-existent pages).
- `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts` (stale `sidebar.content.pages`/`routes`), `apps/openbucket-frontend/src/app/app.config.ts` (`InMemoryTranslateLoader`).
