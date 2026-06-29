---
id: TASK-1852
title: Make the header brand ⌘ icon a palette trigger; add palette i18n keys
story: STORY-0610
status: done
type: implementation
size: S
---

## Description
Make the brand ⌘ icon in the shell sidebar header a clickable trigger that opens the command palette (discoverability for users who do not know the ⌘K shortcut), and localize the palette's group labels, action labels, and placeholder into the en/de dictionaries.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/inset/components/inset-sidebar.component.ts` — modify (brand icon → palette trigger)
- `apps/openbucket-frontend/src/app/layout/shell/sticky/components/sticky-sidebar.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/layout/shell/compact/components/compact-sidebar.component.ts` — modify (same)
- `apps/openbucket-frontend/src/app/layout/shell/command-palette.component.ts` — modify (use `translate` for labels/placeholder)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add `commandPalette` namespace)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (mirror keys, German values)

## Implementation notes
- The brand block in each sidebar renders `<ng-icon name="lucideCommand" class="text-base" />` inside the `hlm-sidebar-header` (the ⌘ mark). Wrap it (or the brand button) so clicking it calls the shell's `openPalette()` (delegate to `CommandPaletteComponent`/the shared open mechanism from TASK-1849); add `type="button"` + an `aria-label` (e.g. "Open command palette") so the trigger is accessible. Keep the existing brand visual.
- If STORY-0601 has consolidated the brand into `ob-brand`, add the click/aria there or on its wrapping button instead of in each sidebar — but the trigger must be reachable from all three variants.
- i18n: add a `commandPalette` namespace to `i18n/{en,de}.translations.ts` (nested object, loaded via the `InMemoryTranslateLoader` and consumed through the `@ngx-translate/core` `translate` pipe), e.g. `commandPalette: { placeholder, empty, groups: { nav, buckets, actions }, actions: { createBucket, createKey, toggleTheme }, trigger }`. Replace hard-coded English in `command-palette.component.ts` with `translate` lookups; reuse `sidebar.*` keys for nav item titles (they already carry i18n keys). Provide real German values.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Clicking the brand ⌘ icon opens the command palette (in inset/sticky/compact); the trigger has an `aria-label`.
- [ ] `en.translations.ts` and `de.translations.ts` both carry a parallel `commandPalette` namespace; palette labels/placeholder render via `translate`.
- [ ] Switching to `de` localizes the palette.

## Acceptance criteria (a11y)
- [ ] The palette dialog is announced to screen readers on open (CDK overlay role); the trigger is keyboard-focusable.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0610] (brand-icon trigger opens; screen-reader announces the dialog; locale spot check).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1849], [TASK-1851]

## References
- UX review 2026-06-22 (IA E/F6 — discoverability of the palette; power-user F).
- `apps/openbucket-frontend/src/app/layout/shell/{inset,sticky,compact}/components/*-sidebar.component.ts` (brand `<ng-icon name="lucideCommand">`), `command-palette.component.ts`, `i18n/{en,de}.translations.ts`, `@ngx-translate/core` (`translate`), `ob-brand` (STORY-0601).
- Interfaces consumed: `CommandPaletteComponent` (TASK-1849), `BrandComponent` (STORY-0601 if present).
