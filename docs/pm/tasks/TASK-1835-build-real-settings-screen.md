---
id: TASK-1835
title: Replace the settings.component.ts stub with a real screen (hlm-card sections, ob-page-header)
story: STORY-0607
status: done
type: implementation
size: S
---

## Description
Turn the "Coming soon" settings placeholder into a real, sectioned screen. Set the page title via the shell page-header service and lay out the screen as a set of `hlm-card` sections (Appearance, Localization, Account) that the subsequent tasks fill with controls. This task is the shell/scaffold; the individual controls land in TASK-1836..1839.

## Files to create / modify
- `apps/openbucket-frontend/src/app/settings/settings.component.ts` — replace stub (currently `template: '<section class="p-6"><h1>SettingsComponent</h1><p>Coming soon.</p></section>'`)

## Implementation notes
- The page title is rendered by `ob-page-header` (`apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts`) which reads `PageHeaderService`. In the component, inject `PageHeaderService` and call `setPageHeader('settings.title', 'settings.subtitle')` (i18n keys land in TASK-1840) in `ngOnInit`/constructor — the header renders the title with the `translate` pipe.
- Import `HlmCardImports` from `@openbucket/spartan-ui/card` (`HlmCard, HlmCardHeader, HlmCardTitle, HlmCardDescription, HlmCardContent, HlmCardFooter, ...`). Lay out one `hlm-card` per section with a `hlm-card-title` + `hlm-card-content`.
- Standalone component; add `TranslateModule` to `imports` for the section titles. Leave clearly-marked content slots/placeholders that TASK-1836 (color scheme + light/dark), TASK-1837 (shell + locale + reset), TASK-1838 (reduced motion), and TASK-1839 (change password) plug into.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Navigating to the settings route shows a titled page (via `ob-page-header`) with `hlm-card` sections instead of "Coming soon".

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0607] (settings screen renders sections).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0602]

## References
- UX review 2026-06-22 (design S1 — appearance unreachable; IA — settings screen).
- `apps/openbucket-frontend/src/app/settings/settings.component.ts`, `apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts` + `services/page-header.service.ts` (`setPageHeader`), `libs/ui/spartan/card` (`HlmCardImports`).
