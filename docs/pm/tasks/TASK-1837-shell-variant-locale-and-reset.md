---
id: TASK-1837
title: Shell-variant hlm-radio-group → setShellVariant(); locale hlm-select → setLocale(); "Reset" → reset()
story: STORY-0607
status: done
type: implementation
size: M
---

## Description
Wire the remaining appearance controls. Add a shell-layout `hlm-radio-group` bound to `AppearanceStore.setShellVariant()`, a language `hlm-select` bound to `AppearanceStore.setLocale()`, and a "Reset to defaults" button bound to `AppearanceStore.reset()`. All three setters persist and apply live (locale also re-applies translations via `LocaleService`).

## Files to create / modify
- `apps/openbucket-frontend/src/app/settings/settings.component.ts` — modify (shell radio group, locale select, reset button)

## Implementation notes
- Inject `AppearanceStore`. Shell variant: the type is `ShellVariant = 'compact' | 'inset' | 'sticky'` (appearance store). Use `HlmRadioGroupImports` from `@openbucket/spartan-ui/radio-group` (`HlmRadioGroup, HlmRadio, HlmRadioIndicator`) with one radio per variant; on change call `appearanceStore.setShellVariant(value)`; reflect `appearanceStore.shellVariant()`.
- Locale: type `LocaleCode = 'en' | 'de'` (`core/platform/common/locale/store/locale.store.ts`; `LOCALE_CONFIGS` has `name`/`nativeName` for labels). Use `HlmSelectImports` from `@openbucket/spartan-ui/select`; on change call `appearanceStore.setLocale(value)` (which calls `localeService.applyLocale(locale)` and persists). Reflect `appearanceStore.locale()`.
- Reset: a button (`hlmBtn`) calling `appearanceStore.reset()` (resets to `defaultState` = `{ theme: 'system', shellVariant: 'inset', tabsVariant: 'default', contentAlignment: 'center', contentMaxWidth: '4xl', colorScheme: 'slate', locale: 'en' }`, re-applies locale, and persists). Confirm-before-reset is optional (the shared `ConfirmDialogComponent` from STORY-0600 may be used but is not required).
- All setters already `saveToStorage(...)`; the root services hot-apply — no manual DOM/localStorage writes here.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] The shell-variant radio group calls `setShellVariant()` and switching variants changes the shell layout live; selection persists across reload.
- [ ] The locale select calls `setLocale()`, switching `en`/`de` re-applies translations live and persists.
- [ ] "Reset to defaults" calls `reset()` and returns theme/scheme/shell/locale to defaults.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0607] (switch shell/locale persists + applies; reset restores defaults).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0602], [TASK-1835]

## References
- UX review 2026-06-22 (design S1 — shell/locale unreachable; interaction F — reset).
- `apps/openbucket-frontend/src/app/core/platform/common/appearance/store/appearance.store.ts` (`ShellVariant`, `setShellVariant`, `setLocale`, `reset`, `defaultState`), `core/platform/common/locale/store/locale.store.ts` (`LocaleCode`, `LOCALE_CONFIGS`), `libs/ui/spartan/{radio-group,select}` (`HlmRadioGroupImports`, `HlmSelectImports`).
- Interfaces consumed: `AppearanceStore.setShellVariant/setLocale/reset`.
