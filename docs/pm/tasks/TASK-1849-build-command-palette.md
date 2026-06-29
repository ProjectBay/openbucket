---
id: TASK-1849
title: Build CommandPaletteComponent on HlmCommandImports, opening on ⌘K
story: STORY-0610
status: done
type: implementation
size: M
---

## Description
Create a `CommandPaletteComponent` in the shell that renders the spartan `command` dialog (search + list + groups + items + shortcuts) and opens on ⌘K / Ctrl-K via a shell `@HostListener`. This task lands the component shell and the open/close + filter plumbing; TASK-1850 seeds the groups and TASK-1851 adds the global shortcuts.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/command-palette.component.ts` — new (selector `ob-command-palette`, standalone, OnPush)
- `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts` — modify (render `<ob-command-palette />` + `@HostListener('document:keydown', …)` to open it)

## Implementation notes
- Import `HlmCommandImports` from `@openbucket/spartan-ui/command`. The library exports `HlmCommand`, `HlmCommandDialog`, `HlmCommandSearch`, `HlmCommandSearchInput`, `HlmCommandList`, `HlmCommandGroup`, `HlmCommandGroupLabel`, `HlmCommandItem`, `HlmCommandSeparator`, `HlmCommandShortcut`, `HlmCommandEmpty`/`HlmCommandEmptyState` (all bundled in the `HlmCommandImports` const array). Build the dialog content from these (`hlm-command` root → `hlm-command-search` with `input hlmCommandSearchInput` → `hlm-command-list` → `hlm-command-group`s of `button hlmCommandItem`).
- Expose an `open` signal (`readonly open = signal(false)`) and `openPalette()`/`closePalette()` methods; the dialog visibility binds to `open()`. Close on Escape and after an item is selected.
- ⌘K/Ctrl-K: add the listener in `DynamicShellLayout` (selector `ob-dynamic-shell`) so it works in all three shell variants, since the dynamic shell wraps inset/sticky/compact: `@HostListener('document:keydown', ['$event'])` → if `(event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'`, `event.preventDefault()` and toggle the palette (call a `@ViewChild(CommandPaletteComponent)` or a shared service). Keep `DynamicShellLayout` OnPush.
- Search input filters items live; show `HlmCommandEmpty`/`HlmCommandEmptyState` when nothing matches.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Pressing ⌘K (mac) / Ctrl-K opens the palette in every shell variant; Escape and selecting an item close it.
- [ ] The palette renders via `HlmCommandImports` (search + list + group + item); typing filters items and shows an empty state when nothing matches.

## Test obligations
- Unit: N/A (interaction-heavy; verified via TEST-0610 manual).
- E2E: covered by [TEST-0610] (⌘K opens; typing filters; Esc closes).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0602]

## References
- UX review 2026-06-22 (IA E/F6 — full command library installed and unused; deep object paths).
- `libs/ui/spartan/command` (`@openbucket/spartan-ui/command`, `HlmCommandImports`: `HlmCommand`/`HlmCommandDialog`/`HlmCommandSearch`/`HlmCommandSearchInput`/`HlmCommandList`/`HlmCommandGroup`/`HlmCommandItem`/`HlmCommandShortcut`/`HlmCommandEmpty`), `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts` (`DynamicShellLayout`, `ob-dynamic-shell`).
- Interfaces produced: `CommandPaletteComponent` (consumed by TASK-1850/1851/1852).
