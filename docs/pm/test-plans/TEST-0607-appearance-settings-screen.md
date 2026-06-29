---
id: TEST-0607
title: Appearance & Settings screen — themes/dark/shell/locale, reduced-motion, change-password
covers: [STORY-0607, TASK-1835, TASK-1836, TASK-1837, TASK-1838, TASK-1839, TASK-1840]
status: done
level: e2e
---

## Goal
Verify the Settings screen is real and wired: the page renders sectioned `hlm-card`s with an `ob-page-header` title; 12 color-scheme swatches drive `setColorScheme()`; light/dark/system drives `setTheme()`; shell-variant drives `setShellVariant()`; locale drives `setLocale()`; "Reset" calls `reset()`; a reduced-motion toggle suppresses animations; and change-password posts to `SettingsAdminService.changePassword` with toast + inline validation. All appearance choices persist across reloads and labels are localized (en/de).

## Setup
- Frontend served against a running backend: `nx serve openbucket-frontend` (frontend on Node 23). Backend running so `POST /api/admin/settings/change-password` responds (2xx and an error path, e.g. wrong current password).
- The shared `notify` toaster (STORY-0600) mounted; navigation/routing to the settings route in place (STORY-0602).
- Browser dev-tools to inspect `<html>` classes/attributes (`.dark`, the color-scheme `<link>`, reduced-motion marker) and the `appearance-settings` localStorage key.

## Cases
1. Screen: given the settings route, then `ob-page-header` shows the localized title and the screen renders `hlm-card` sections (Appearance, Localization, Account) — not "Coming soon".
2. Color scheme: given the 12 swatch tiles, when one is clicked, then `setColorScheme()` is called, the palette changes live (the `<scheme>.css` `<link>` swaps), and the selected tile shows the `ring-ring` selection; verify rose and yellow specifically.
3. Theme: given the light/dark/system toggle, when toggled, then `setTheme()` is called and `.dark` is added/removed on `<html>` live; verify a dark scheme looks correct.
4. Shell variant: given the shell `hlm-radio-group`, when changed, then `setShellVariant()` is called and the shell layout changes live (compact/inset/sticky).
5. Locale: given the locale `hlm-select`, when switched en↔de, then `setLocale()` is called and all settings labels re-render in the chosen language with no raw `settings.*` keys (TASK-1840).
6. Reset: given changed appearance, when "Reset to defaults" is clicked, then `reset()` returns theme=system, scheme=slate, shell=inset, locale=en.
7. Persistence: after setting scheme/theme/shell/locale, when the page is reloaded, then the selections are restored from `appearance-settings` localStorage and applied.
8. Reduced motion: given the reduced-motion toggle, when enabled, then animations are suppressed app-wide (via STORY-0616's mechanism); honoring the OS setting is the default; the choice persists.
9. Change password: given the form, when submitted invalid (empty / confirm mismatch), then Submit is disabled and inline `hlm-error` text shows; when submitted valid, then `{ currentPassword, newPassword }` POSTs via `changePassword` and a success toast fires; a server failure fires an error toast (no raw error object).

## Tooling
- Framework: jest (`@testing-library/angular` optional) for change-password validation/mapping where the frontend harness runs; otherwise manual in the browser.
- Runner: `nx test openbucket-frontend --testPathPatterns=settings` (if wired); `nx serve openbucket-frontend` for manual; `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–9 verified (unit for change-password validation where the harness runs; otherwise manual); rose/yellow + dark confirmed to look correct.

## References
- UX review 2026-06-22 (design S1; IA settings/appearance; interaction F).
- STORY-0607 and TASK-1835..1840; `apps/openbucket-frontend/src/app/settings/{settings,change-password}.component.ts`, `core/platform/common/appearance/store/appearance.store.ts`.
