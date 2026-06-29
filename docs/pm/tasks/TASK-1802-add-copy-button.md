---
id: TASK-1802
title: Add a copy-to-clipboard button component with feedback
story: STORY-0600
status: done
type: implementation
size: S
---

## Description
Add a reusable `copy-button` that copies a value to the clipboard, fires a "Copied" toast (via `notify`, TASK-1800), briefly swaps its icon, and carries an accessible label + tooltip. Used for access-key IDs/secrets, ETags, version IDs, and share links across EPIC-07.

## Files to create / modify
- `apps/openbucket-frontend/src/app/shared/ui/copy-button.component.ts` — new

## Implementation notes
- Standalone, OnPush. Inputs: `value: string`, `label = 'Copy'` (used for `aria-label` + tooltip text).
- Render an icon button: `hlmBtn variant="ghost" size="icon"` (`@openbucket/spartan-ui/button`), wrapped with `HlmTooltipImports` (`[HlmTooltip, HlmTooltipTrigger]` from `@openbucket/spartan-ui/tooltip`).
- Icons via `@ng-icons/lucide`: `lucideCopy` default, swap to `lucideCheck` for ~1500ms after a successful copy (use a signal + `setTimeout`, cleared on destroy).
- Copy with `navigator.clipboard.writeText(value)`; on success call `notify.success('Copied')` (TASK-1800); on failure `notify.error('Copy failed')`.
- Set `[attr.aria-label]="label"` on the button so the icon-only control has an accessible name (WCAG 4.1.2).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (no icon-only-button a11y warning).
- [ ] Clicking copies `value` to the clipboard, shows the "Copied" toast, and swaps icon to check then back.
- [ ] The button exposes `aria-label` and a tooltip equal to `label`.

## Test obligations
- Unit: covered by [TEST-0600] (writeText called with value; notify fired; icon toggles).
- E2E: N/A.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1800]

## References
- UX review 2026-06-22 (interaction F7, a11y — copy affordance with feedback).
- `libs/ui/spartan/{button,tooltip}`, `@ng-icons/lucide`.
- Interfaces produced: `CopyButtonComponent` (consumed by STORY-0604/0611/0615).
