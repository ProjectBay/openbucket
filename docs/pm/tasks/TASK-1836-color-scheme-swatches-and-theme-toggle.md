---
id: TASK-1836
title: Color-scheme swatch picker (12 tiles) → setColorScheme(); light/dark/system toggle → setTheme()
story: STORY-0607
status: done
type: implementation
size: M
---

## Description
Wire the appearance engine's color scheme and light/dark mode to real controls. Render 12 swatch tiles — one per `ColorScheme` — each previewing that scheme's tokens, with the active one ringed, bound to `AppearanceStore.setColorScheme()`. Add a light/dark/system toggle bound to `AppearanceStore.setTheme()`. Both setters already persist to `localStorage` and hot-apply via `ColorSchemeService`/`ThemeService`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/settings/settings.component.ts` — modify (add the Appearance card's scheme tiles + theme toggle)

## Implementation notes
- Inject `AppearanceStore` (`apps/openbucket-frontend/src/app/core/platform/common/appearance/store/appearance.store.ts`, `providedIn: 'root'`). The 12 schemes are the `ColorScheme` union: `'slate' | 'gray' | 'zinc' | 'neutral' | 'stone' | 'violet' | 'blue' | 'green' | 'orange' | 'red' | 'rose' | 'yellow'` — each maps 1:1 to a CSS bundle in `apps/openbucket-frontend/src/styles/themes/<scheme>.css` (loaded by `ColorSchemeService`).
- Build a `readonly schemes: ColorScheme[] = [...]` and render a tile per scheme. On click call `appearanceStore.setColorScheme(scheme)`. Mark the active tile (`appearanceStore.colorScheme() === scheme`) with the `ring-ring` (selected ring) classes per the AC. Each tile previews the scheme's primary/accent tokens (e.g. small color blocks).
- Theme toggle: use `HlmToggleGroupImports` from `@openbucket/spartan-ui/toggle-group` with three items `light` / `dark` / `system`; on change call `appearanceStore.setTheme(value)` where `value: Theme = 'light' | 'dark' | 'system'`. Reflect the current `appearanceStore.theme()`.
- `setColorScheme`/`setTheme` persist (`saveToStorage`) and the root-provided `ColorSchemeService`/`ThemeService` effects hot-swap the `<link>` / toggle the `.dark` class — no manual DOM work needed here.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] 12 swatch tiles render; clicking one calls `setColorScheme()` and the app's palette changes live; the selected tile shows the `ring-ring` selection.
- [ ] The light/dark/system toggle calls `setTheme()` and toggling dark adds/removes `.dark` on `<html>` live.
- [ ] Both selections persist across a reload (localStorage `appearance-settings`).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0607] (switch scheme + theme; persists across reload; rose/yellow + dark verified).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0602], [TASK-1835]

## References
- UX review 2026-06-22 (design S1 — themes/dark unreachable).
- `apps/openbucket-frontend/src/app/core/platform/common/appearance/store/appearance.store.ts` (`ColorScheme`, `Theme`, `setColorScheme`, `setTheme`, `colorScheme`, `theme`), `appearance/services/{color-scheme,theme}.service.ts`, `apps/openbucket-frontend/src/styles/themes/*.css`, `libs/ui/spartan/toggle-group` (`HlmToggleGroupImports`).
- Interfaces consumed: `AppearanceStore` (built in EPIC platform scaffold; `setColorScheme`/`setTheme`).
