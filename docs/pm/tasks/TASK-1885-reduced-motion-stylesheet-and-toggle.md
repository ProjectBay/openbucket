---
id: TASK-1885
title: Global reduced-motion stylesheet block + wire the Settings toggle
story: STORY-0616
status: done
type: implementation
size: S
---

## Description
Add a global `@media (prefers-reduced-motion: reduce)` block that neutralizes spartan's `animate-in`/zoom/fade transitions and the toaster animation, and wire the appearance Settings toggle (STORY-0607) so a user who prefers reduced motion (or sets it explicitly) gets a calm UI.

## Files to create / modify
- `apps/openbucket-frontend/src/styles.css` (or the global stylesheet — confirm the real entry) — modify (add the reduced-motion block + a `[data-reduced-motion='true']` override)
- `apps/openbucket-frontend/src/app/core/platform/common/appearance/store/appearance.store.ts` — modify (add `reducedMotion` to `AppearanceState` + `setReducedMotion`)
- `apps/openbucket-frontend/src/app/settings/settings.component.ts` — modify (add the toggle; STORY-0607 builds the screen)

## Implementation notes
- Global CSS: add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }` to neutralize spartan/Tailwind `animate-in`, `zoom-in`, `fade-in` and the `ngx-sonner` toaster animation (WCAG 2.3.3 Animation from Interactions).
- Explicit toggle: the `AppearanceStore` (`appearance.store.ts`) currently has no `reducedMotion`; it already reads `prefers-color-scheme`. Add `reducedMotion: boolean` to `AppearanceState` and a `setReducedMotion(v)` updater (mirroring `setTheme`/`setColorScheme`), persisted with the rest of the appearance state. When `true`, set `data-reduced-motion="true"` on the document root and add a CSS override block keyed on `[data-reduced-motion='true']` that applies the same neutralization regardless of the OS media query.
- Settings screen (currently a "Coming soon" placeholder; STORY-0607 builds it): add an `HlmSwitch` (`@openbucket/spartan-ui/switch`) bound to the store's `reducedMotion`, with a localized label.
- Default `reducedMotion` to follow the OS (`prefers-reduced-motion`) on first run, then honor the explicit user choice.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] With OS reduced-motion on (or the Settings toggle on), spartan `animate-in`/zoom/fade and the toaster animation are suppressed (manual: open a sheet/dialog/toast — no animation).
- [ ] The Settings toggle persists across reload via `AppearanceStore`.

## Test obligations
- Unit: covered by [TEST-0616] (`setReducedMotion` updates state + root attribute).
- E2E: covered by [TEST-0616] (manual: motion-sensitive run-through).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0603], [STORY-0604]

## References
- UX review 2026-06-22 (a11y A11Y-6 — no reduced-motion handling; WCAG 2.3.3).
- `apps/openbucket-frontend/src/app/core/platform/common/appearance/store/appearance.store.ts` (`AppearanceState`, reads `prefers-color-scheme`), `apps/openbucket-frontend/src/app/settings/settings.component.ts`, `libs/ui/spartan/switch`.
- Related: [STORY-0607] (appearance settings screen owns the toggle UI).
