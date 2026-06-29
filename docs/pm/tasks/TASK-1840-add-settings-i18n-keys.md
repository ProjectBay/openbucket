---
id: TASK-1840
title: Add Settings i18n keys (en/de)
story: STORY-0607
status: done
type: implementation
size: XS
---

## Description
Add the English and German translation keys the settings + change-password screens consume (section titles, control labels, option labels, reset, toast messages, validation text), so the new screens are fully localized and switching locale re-renders them.

## Files to create / modify
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add a `settings` section)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (add the matching `settings` section)

## Implementation notes
- The translation files are plain nested-object dictionaries (`export default { ... }`) loaded by `InMemoryTranslateLoader` in `app.config.ts` and resolved via the `translate` pipe / `TranslateService`. Today `en.translations.ts` has a top-level `sidebar` section — add a sibling top-level `settings` section.
- Add keys covering everything the settings tasks reference, e.g.:
  - `settings.title`, `settings.subtitle` (used by `setPageHeader` in TASK-1835).
  - `settings.appearance.title`, `settings.appearance.colorScheme`, `settings.appearance.theme`, `settings.appearance.theme.{light,dark,system}`, `settings.appearance.shellVariant` (+ `compact/inset/sticky`), `settings.appearance.reducedMotion`, `settings.appearance.reset`.
  - `settings.localization.title`, `settings.localization.language`.
  - `settings.account.title`, `settings.changePassword.{current,new,confirm,submit}`, validation strings (`required`, `mismatch`, `minLength`), and success/error toast text.
- Mirror EVERY key in `de.translations.ts` with German copy — the two files must have the same key shape (no missing keys) so neither locale shows raw keys.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Every i18n key referenced by TASK-1835..1839 exists in both `en` and `de` (no raw `settings.*` keys render in either locale).
- [ ] Switching locale on the settings screen re-renders all labels in the chosen language.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0607] (switch locale; settings labels translate; no raw keys).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0602], [TASK-1835]

## References
- UX review 2026-06-22 (IA — settings/localization).
- `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`, `apps/openbucket-frontend/src/app/app.config.ts` (`InMemoryTranslateLoader`, `TranslateModule`), `apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts` (`translate` pipe).
