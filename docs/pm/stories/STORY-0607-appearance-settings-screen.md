---
id: STORY-0607
title: Appearance & Settings screen (themes/dark/shell/locale) + change-password
epic: EPIC-07
status: done
size: M
risk: low
---

## User story
As an admin, I want a Settings screen to pick my color theme, light/dark mode, shell layout, and language, and to change my password, so the console matches my preference and I'm not editing localStorage by hand.

## Description
The whole appearance engine (`AppearanceStore` with `setTheme`/`setColorScheme`/`setShellVariant`/`setTabsVariant`/`setLocale`, 12 theme CSS bundles, light/dark via `.dark`, hot-swapped color-scheme `<link>`) is built but unreachable — `settings.component.ts` is a "Coming soon" stub and the setters are never called from a template. `change-password.component.ts` is an `export {}` stub even though `SettingsAdminService.changePassword` exists. This is the single highest-ROI visual win.

## Acceptance criteria
- [ ] `settings.component.ts` is a real screen (sections in `hlm-card`, title via `ob-page-header`).
- [ ] A color-scheme picker shows 12 swatch tiles (rendering each scheme's tokens, selected `ring-ring`) bound to `AppearanceStore.setColorScheme()`.
- [ ] Light/dark/system control bound to `setTheme()`; shell-variant picker bound to `setShellVariant()`; locale picker bound to `setLocale()`; a "Reset to defaults".
- [ ] A reduced-motion preference toggle (or honoring the OS setting) is exposed.
- [ ] `change-password.component.ts` implemented on the design-system form → `SettingsAdminService.changePassword` with toast + validation.

## Tasks
- [TASK-1835] Replace the `settings.component.ts` stub with a real screen (`hlm-card` sections, `ob-page-header`).
- [TASK-1836] Color-scheme swatch picker (12 tiles) → `setColorScheme()`; light/dark/system via `hlm-toggle-group` → `setTheme()`.
- [TASK-1837] Shell-variant `hlm-radio-group` → `setShellVariant()`; locale `hlm-select` → `setLocale()`; "Reset" → `reset()`.
- [TASK-1838] Reduced-motion toggle wired to the global `prefers-reduced-motion` handling (STORY-0616).
- [TASK-1839] Implement `change-password.component.ts` (hlm form) → `SettingsAdminService.changePassword` + `notify` + inline validation.
- [TASK-1840] Add Settings i18n keys (en/de).

## Test plan
- [TEST-0607] Manual: switching each theme/scheme/shell/locale persists + applies live across reloads; change-password success/failure toasts; verify a couple of themes (rose/yellow) + dark look correct.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0600], [STORY-0602]

## References
- UX review 2026-06-22 (design S1; IA settings/appearance; interaction F).
- `apps/openbucket-frontend/src/app/settings/{settings,change-password}.component.ts`, `core/platform/common/appearance/store/appearance.store.ts`, `appearance/services/{theme,color-scheme}.service.ts`, `libs/api-client/src/lib/api/settings-admin.service.ts`.
