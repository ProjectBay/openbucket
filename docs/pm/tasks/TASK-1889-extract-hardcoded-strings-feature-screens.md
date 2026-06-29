---
id: TASK-1889
title: Extract hardcoded strings from feature screens into en.translations.ts
story: STORY-0617
status: done
type: refactor
size: M
---

## Description
Replace hardcoded English literals in the buckets/objects/keys/auth/settings feature screens with `| translate` keys, adding the keys to `en.translations.ts` and importing `TranslateModule` wherever it is missing. Today only the shell/sidebar uses translation keys; the feature screens are raw English.

## Files to create / modify
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add `buckets` / `objects` / `keys` / `auth` / `settings` key groups)
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (replace literals; import `TranslateModule`)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/objects/object-row.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/keys/keys-list.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/auth/login.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/auth/force-rotate.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/settings/settings.component.ts` — modify (same)

## Implementation notes
- The translation files are a nested default-export object; the only top-level key today is `sidebar`. Add sibling groups, e.g. `buckets`, `objects`, `keys`, `auth`, `settings`, each holding the screen's strings.
- Concrete literals to extract (current code):
  - `bucket-list.component.ts`: "Buckets", "Create bucket", "Loading…", "No buckets yet.", "Name", "Objects", "Size", "Created", "Enable versioning", "Cancel", "Creating…", "Create", and the create/delete error messages.
  - `object-browser.component.ts`: "← Back", "Next →", "Loading…", "Name", "Size", "Modified", "ETag", "This prefix is empty.", "Content-Type", "Version", "Download", "Close" (lines 48–125).
  - `auth/login.component.ts`, `auth/force-rotate.component.ts`: the form labels/buttons/error text.
- Import pattern: add `TranslateModule` from `@ngx-translate/core` to each standalone component's `imports` and use the `| translate` pipe, matching the shell headers (e.g. `page-header.component.ts`: `{{ pageHeader.pageTitle() | translate }}`). For interpolated strings, use parameterized translations (`translate.instant(key, params)`).
- This task only adds the EN keys + wiring; the DE side + stale-key pruning is TASK-1890; shared-primitive strings (toast/confirm/empty-state) are TASK-1891. Some EPIC-07 screens are rebuilt by STORY-0603/0604/0607/0611 and add their strings through this convention as they land.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] No hardcoded English literal remains in the buckets/objects/keys/auth/settings templates (every user-facing string uses a key).
- [ ] Each listed component imports `TranslateModule` and the new keys exist in `en.translations.ts`.

## Test obligations
- Unit: covered by [TEST-0617] (no-literal grep + key resolution).
- E2E: covered by [TEST-0617] (manual: strings render via keys).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0603], [STORY-0604], [STORY-0607], [STORY-0611]

## References
- UX review 2026-06-22 (cross-cutting i18n — feature screens hardcode English).
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts`, `apps/openbucket-frontend/src/app/{buckets,objects,keys,auth,settings}/**`, `apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts` (translate-pipe pattern).
