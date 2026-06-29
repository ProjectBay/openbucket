---
id: TASK-1892
title: Document the "no hardcoded UI strings" convention + optional lint rule
story: STORY-0617
status: done
type: docs
size: XS
---

## Description
Document the project convention that all user-facing UI strings go through `@ngx-translate` keys (no hardcoded English in templates), and add an optional lint guard so new hardcoded strings are flagged in CI.

## Files to create / modify
- `apps/openbucket-frontend/README.md` (or `docs/` conventions) — modify/new (the "no hardcoded UI strings" section)
- `apps/openbucket-frontend/eslint.config.mjs` — modify (optional: add a template no-literal rule)

## Implementation notes
- Convention to document: user-facing strings live in `i18n/{en,de}.translations.ts` as nested keys and are rendered via the `| translate` pipe (or `TranslateService.instant` at call sites for toasts/dialogs); `en` and `de` key sets must stay identical; add the `de` translation when you add the `en` key; do not leave a key without a `de` counterpart (it silently falls back to the key string).
- Optional lint guard: enable `@angular-eslint/template/i18n` (the angular-eslint template rule that flags untranslated text/attribute literals) in the `files: ['**/*.html']` block of `apps/openbucket-frontend/eslint.config.mjs`. If full enforcement is too noisy mid-migration, scope it to `warn` initially or to the rebuilt feature folders, and note the intent to escalate to `error` once TASK-1889/1891 land. The doc convention is the required deliverable; the lint rule is the optional automated backstop.
- Reference the i18n setup in `app.config.ts` (`TranslateModule.forRoot`, `InMemoryTranslateLoader`) and the translate-pipe example in `page-header.component.ts`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] A written "no hardcoded UI strings" convention exists (location committed) covering keys, the `| translate` pipe, and en/de parity.
- [ ] If the optional lint rule is enabled, `nx lint openbucket-frontend` still passes (rule at `warn` or scoped) and the doc states how to escalate it to `error`.

## Test obligations
- Unit: N/A — docs/convention.
- E2E: covered by [TEST-0617] (the grep-for-literals check operationalizes the convention).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1889], [TASK-1890], [TASK-1891]

## References
- UX review 2026-06-22 (cross-cutting i18n notes).
- `apps/openbucket-frontend/src/app/app.config.ts` (`TranslateModule.forRoot`, `InMemoryTranslateLoader`), `apps/openbucket-frontend/eslint.config.mjs`, `@angular-eslint/template/i18n`.
