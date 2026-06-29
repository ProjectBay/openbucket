---
id: STORY-0616
title: Accessibility & inclusive-design hardening (WCAG 2.2 AA)
epic: EPIC-07
status: done
size: M
risk: medium
---

## User story
As a keyboard-only, screen-reader, low-vision, or motion-sensitive admin, I want the console to be fully operable, announced, legible in every theme, and calm, so I can use it like anyone else.

## Description
Cross-cutting a11y items not absorbed by the per-screen rebuilds: app-wide live regions + route-change announcement + skip link, accessible names for icon-only shell controls, a color-contrast audit across all 12 themes, reduced-motion handling, table/heading semantics, and re-enabling the angular-eslint a11y rules that were downgraded to `warn`.

## Acceptance criteria
- [ ] A skip-to-content link is the first focusable element, targeting `<main>`; route changes move focus to `<main>` and announce the page via `LiveAnnouncer`.
- [ ] Icon-only controls have accessible names (sidebar trigger, mobile toggle, sticky search) — fixed at the spartan primitive where shared.
- [ ] A documented contrast audit fixes `--muted-foreground`/`--primary-foreground`/`--ring` failures across `styles/themes/*.css` to WCAG 1.4.3 (4.5:1 text, 3:1 non-text); focus rings ≥3:1 in all themes.
- [ ] A global `@media (prefers-reduced-motion: reduce)` neutralizes spartan `animate-in`/zoom/fade + toaster animation; the Settings toggle (STORY-0607) hooks it.
- [ ] `<th scope>` set on data tables; one `<h1>` per page resolved; sidebar icons adjacent to labels marked decorative.
- [ ] `apps/openbucket-frontend/eslint.config.mjs` sets `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control`, `elements-content`, `valid-aria` back to `error`; `nx lint openbucket-frontend` passes.

## Tasks
- [TASK-1882] Skip link + route-change focus/announce in `DynamicShellLayout` (reuse `StatusAnnouncer`).
- [TASK-1883] Accessible names for icon-only shell controls (prefer `sr-only` inside `HlmSidebarTrigger`).
- [TASK-1884] Contrast audit + token fixes across all 12 `styles/themes/*.css`; add a token-contrast check.
- [TASK-1885] Global reduced-motion stylesheet block; wire the Settings toggle.
- [TASK-1886] Table `scope`/heading-hierarchy/decorative-icon pass on rebuilt screens.
- [TASK-1887] Re-enable the downgraded angular-eslint a11y rules to `error`; fix residual violations.
- [TASK-1888] Manual screen-reader + keyboard-only run-through of the core flows.

## Test plan
- [TEST-0616] `nx lint openbucket-frontend` green with a11y rules at `error`; automated contrast check across themes; manual NVDA/VoiceOver + keyboard-only pass of login → buckets → objects → settings.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0600], [STORY-0603], [STORY-0604] (rebuilt screens land first)

## References
- UX review 2026-06-22 (accessibility lens A11Y-3/4/5/6, F1–F12).
- `apps/openbucket-frontend/src/app/layout/shell/**`, `styles/themes/*.css`, `eslint.config.mjs`, `libs/ui/spartan/sidebar/src/lib/hlm-sidebar-trigger.ts`, `app.config.ts`.
