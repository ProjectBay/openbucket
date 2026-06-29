---
id: TASK-1883
title: Accessible names for icon-only shell controls
story: STORY-0616
status: done
type: implementation
size: S
---

## Description
Give every icon-only control in the shell an accessible name so screen-reader users know what it does: the sidebar trigger, the mobile toggle, and the sticky search. Where the control is a shared spartan primitive, fix it at the primitive (e.g. an `sr-only` label inside `HlmSidebarTrigger`) so every consumer benefits.

## Files to create / modify
- `libs/ui/spartan/sidebar/src/lib/hlm-sidebar-trigger.ts` — modify (add an `sr-only` label / `aria-label` to the icon-only trigger)
- `apps/openbucket-frontend/src/app/layout/shell/{inset,sticky,compact}/components/*-header.component.ts` — modify (any icon-only mobile toggle / search button gets `aria-label`)

## Implementation notes
- `HlmSidebarTrigger` (`selector: 'button[hlmSidebarTrigger]'`) renders only `<ng-icon hlm name="lucidePanelLeft" size="sm">` with no accessible name (WCAG 4.1.2 Name, Role, Value failure). Add a visually-hidden label inside the button, e.g. `<span class="sr-only">Toggle sidebar</span>`, or bind `[attr.aria-label]` on the host. Prefer the `sr-only` span so the name is localizable by the consumer; keep `data-slot`/`data-sidebar` host attrs and the existing `provideBrnButtonConfig` unchanged.
- Note `libs/ui/**` is currently in the ESLint `ignores` list (root `eslint.config.mjs`), so this fix is not itself linted — but it removes the missing-name failure for every app consumer.
- For app-level icon-only controls (mobile sidebar toggle, sticky search button) in the shell headers, add `[attr.aria-label]` (localized via `translate`) directly — these ARE linted and would otherwise trip the a11y rules re-enabled by TASK-1887.
- The shared `CopyButtonComponent` (TASK-1802) already sets `aria-label`; do not duplicate.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass with the a11y rules at `error` (TASK-1887).
- [ ] The sidebar trigger, mobile toggle, and sticky search each expose an accessible name (verified in the a11y tree / NVDA).
- [ ] The fix to the sidebar trigger is at the primitive (`HlmSidebarTrigger`), not duplicated per consumer.

## Test obligations
- Unit: N/A (markup change).
- E2E: covered by [TEST-0616] (manual: screen reader announces each control's name).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0603], [STORY-0604]

## References
- UX review 2026-06-22 (a11y A11Y-4 — icon-only controls lack names; WCAG 4.1.2).
- `libs/ui/spartan/sidebar/src/lib/hlm-sidebar-trigger.ts` (renders only `<ng-icon name="lucidePanelLeft">`), shell header components under `apps/openbucket-frontend/src/app/layout/shell/{inset,sticky,compact}/components/`.
