---
id: TASK-1851
title: Add global keyboard shortcuts + hlm-kbd hints
story: STORY-0610
status: done
type: implementation
size: M
---

## Description
Add a small set of global keyboard shortcuts driven from the shell — `/` to focus the object/global search, `g b` / `g k` to go to Buckets / Keys, and `Esc` to close the palette — and render the shortcut hints with `hlm-kbd` (inside palette items and the search affordance). Shortcuts must not fire while the user is typing in an input/textarea (except the palette's own search).

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts` — modify (extend the `@HostListener('document:keydown')` with the shortcut map + `g`-prefix sequence handling)
- `apps/openbucket-frontend/src/app/layout/shell/command-palette.component.ts` — modify (render `hlm-kbd` hints; `HlmCommandShortcut` per item)

## Implementation notes
- Extend the keydown handler from TASK-1849. Guard against typing: ignore shortcuts (other than the palette's own search) when `document.activeElement` is an `<input>`/`<textarea>`/`[contenteditable]`, and when `event.metaKey`/`ctrlKey`/`altKey` are held (so ⌘K still routes to the palette).
- Shortcuts:
  - `/` → focus the global/object search field (`event.preventDefault()` then focus it).
  - `g` then `b` → `router.navigate(['/buckets'])`; `g` then `k` → `router.navigate(['/keys'])`. Implement the `g`-prefix as a short-lived sequence (a signal/flag set on `g`, cleared on a timeout or the next key).
  - `Esc` → close the palette (delegate to `CommandPaletteComponent.closePalette()`).
- Hints: import `HlmKbdImports` from `@openbucket/spartan-ui/kbd` (`HlmKbd`, selector `kbd[hlmKbd]`; `HlmKbdGroup`, selector `kbd[hlmKbdGroup]`). Render `<kbd hlmKbd>⌘</kbd><kbd hlmKbd>K</kbd>` near the trigger and use `HlmCommandShortcut` (from `HlmCommandImports`) to show per-item hints (e.g. `g b` on the Buckets item).
- Keep the shortcuts discoverable: the palette items for Buckets/Keys show their `g b` / `g k` hint via `HlmCommandShortcut`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `/` focuses the search field; `g b` navigates to Buckets, `g k` to Keys; `Esc` closes the palette.
- [ ] Shortcuts do not fire while typing in a normal input/textarea (the palette search still works).
- [ ] `hlm-kbd` hints render (e.g. ⌘K near the trigger; `g b`/`g k` via `HlmCommandShortcut` in the palette).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0610] (shortcuts work; do not fire while typing; hints render).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1849], [TASK-1850]

## References
- UX review 2026-06-22 (power-user F/F7 — single-key navigation; visible hints).
- `libs/ui/spartan/kbd` (`@openbucket/spartan-ui/kbd`, `HlmKbdImports`: `HlmKbd`/`HlmKbdGroup`), `libs/ui/spartan/command` (`HlmCommandShortcut`), `apps/openbucket-frontend/src/app/layout/shell/{dynamic-shell.component.ts,command-palette.component.ts}`.
- Interfaces consumed: `CommandPaletteComponent` (TASK-1849).
