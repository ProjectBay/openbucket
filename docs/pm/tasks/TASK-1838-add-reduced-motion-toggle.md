---
id: TASK-1838
title: Add a reduced-motion preference toggle wired to global prefers-reduced-motion handling
story: STORY-0607
status: done
type: implementation
size: S
---

## Description
Expose a reduced-motion preference in the settings screen: a toggle that either honors the OS `prefers-reduced-motion` setting or lets the operator force motion off. It drives the same global handling that STORY-0616 establishes (a root attribute/class that CSS keys off to disable animations).

## Files to create / modify
- `apps/openbucket-frontend/src/app/settings/settings.component.ts` — modify (add the reduced-motion toggle in the Appearance card)

## Implementation notes
- Use `HlmSwitchImports` from `@openbucket/spartan-ui/switch` (or `HlmToggleGroupImports` for a system/on/off tri-state) for the control in the Appearance section.
- The global handling is owned by STORY-0616 ("global `prefers-reduced-motion` handling" — referenced by this story's TASK list). This task wires the settings control to that mechanism: if STORY-0616 exposes a store flag / service method, call it; otherwise default to honoring the OS via `window.matchMedia('(prefers-reduced-motion: reduce)')` and toggling a documented root marker (e.g. `data-reduced-motion` on `<html>`) that the global CSS respects.
- Persist the operator's explicit choice the same way appearance settings persist (alongside `appearance-settings` localStorage, or via STORY-0616's store if it owns persistence) so it survives reload.
- Keep this additive: do not duplicate STORY-0616's mechanism — call into it.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] A reduced-motion control is present in the settings screen.
- [ ] Toggling it disables/enables animations app-wide (via the global handling); honoring the OS setting is the default when not explicitly overridden; the choice persists across reload.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0607] (toggle reduced motion; animations suppressed; persists).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0602], [TASK-1835]

## References
- UX review 2026-06-22 (a11y — reduced motion preference).
- `apps/openbucket-frontend/src/app/settings/settings.component.ts`, global `prefers-reduced-motion` handling (STORY-0616), `libs/ui/spartan/switch` (`HlmSwitchImports`).
- Related: STORY-0616 (global reduced-motion mechanism this toggle drives).
