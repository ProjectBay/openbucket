---
id: TASK-1844
title: Add auth i18n keys (en/de) for login + force-rotate
story: STORY-0608
status: done
type: implementation
size: XS
---

## Description
Add an `auth` translation namespace to the en/de dictionaries and switch the hard-coded English strings in `login.component.ts` and `force-rotate.component.ts` to `translate`-pipe lookups, so the auth screens are localized like the rest of the console.

## Files to create / modify
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add `auth` namespace)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (mirror keys, German values)
- `apps/openbucket-frontend/src/app/auth/login.component.ts` — modify (use `translate` pipe)
- `apps/openbucket-frontend/src/app/auth/force-rotate.component.ts` — modify (use `translate` pipe)

## Implementation notes
- Translations are plain nested objects exported `default` from `i18n/{en,de}.translations.ts` and loaded into `@ngx-translate/core` via the `InMemoryTranslateLoader` in `app.config.ts` (`TranslateModule.forRoot({ defaultLanguage: 'en', … })`). Add a sibling namespace to the existing `sidebar` object, e.g.:
  ```ts
  auth: {
    login: { title, subtitle, username, password, submit, submitBusy },
    forceRotate: { title, subtitle, current, new, confirm, submit, mismatch },
    errors: { invalidCredentials, unreachable, generic },
  }
  ```
  Keep the dotted-key shape consumed by the pipe (e.g. `'auth.login.title'`), matching how `sidebar.workspace.label` is used today.
- In the components, import `TranslateModule` from `@ngx-translate/core` and render labels via the `translate` pipe (e.g. `{{ 'auth.login.submit' | translate }}`). Keep the busy ternary by switching keys: `{{ (busy() ? 'auth.login.submitBusy' : 'auth.login.submit') | translate }}`.
- The `messageFor` mapping should resolve to the new `auth.errors.*` keys (translate the resolved key for display); preserve the same status→message branching from TASK-1841/1842.
- Provide real German values in `de.translations.ts` (do not leave English placeholders).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `en.translations.ts` and `de.translations.ts` both contain a parallel `auth` namespace (same key set).
- [ ] `login.component.ts` and `force-rotate.component.ts` render their visible strings through the `translate` pipe (no remaining hard-coded English in the templates).
- [ ] Switching locale to `de` shows the German auth strings.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0608] (locale-switch spot check is part of the manual pass).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1841], [TASK-1843]

## References
- UX review 2026-06-22 (design S4 — auth screens not localized).
- `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`, `app.config.ts` (`InMemoryTranslateLoader`, `TranslateModule.forRoot`), `@ngx-translate/core` (`translate` pipe).
