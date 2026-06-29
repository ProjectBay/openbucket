---
id: TEST-0616
title: Accessibility & inclusive-design hardening (WCAG 2.2 AA)
covers: [STORY-0616, TASK-1882, TASK-1883, TASK-1884, TASK-1885, TASK-1886, TASK-1887, TASK-1888]
status: done
level: e2e
---

## Goal
Verify the cross-cutting a11y hardening: lint passes with the angular-eslint a11y rules at `error`, contrast passes across all 12 themes, and a manual NVDA/VoiceOver + keyboard-only pass of login → buckets → objects → settings confirms skip link, route announce, accessible names, reduced motion, table/heading semantics, and visible focus.

## Setup
- Frontend on Node 23 (`nx serve openbucket-frontend` for the manual pass; `nx lint`/`nx build` for the gates). Backend on Node 20 if a live login is needed.
- NVDA on Windows (primary screen reader) and VoiceOver on macOS if available; a keyboard with no mouse for the keyboard-only pass.
- `node` (Node 23) for the token-contrast check (`apps/openbucket-frontend/tools/contrast-check.mjs`).

## Cases
1. Given `apps/openbucket-frontend/eslint.config.mjs` with `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control`, `elements-content`, `valid-aria` at `error`, when `nx lint openbucket-frontend` runs, then it passes with zero violations.
2. Given the 12 theme stylesheets, when the contrast check runs, then every audited text pair is ≥ 4.5:1 and every non-text/`--ring` pair ≥ 3:1 in both light and dark blocks; the check exits 0.
3. Given a fresh page load, when Tab is pressed, then the skip link is the first focusable element and activating it focuses `<main id="main-content">`; on each route change focus moves to `<main>` and the page title is announced (LiveAnnouncer).
4. Given the sidebar trigger, mobile toggle, and sticky search, when reached by screen reader, then each announces an accessible name.
5. Given OS reduced-motion on (or the Settings toggle on), when a sheet/dialog/toast opens, then no animation plays; the toggle persists across reload.
6. Given the data tables, when navigated in screen-reader table mode, then each `<th scope>` is associated with its cells; each page has exactly one `<h1>`; icons adjacent to labels are not double-announced.
7. Given a keyboard-only operator, when walking login → buckets → objects → settings, then every interactive element is reachable, operable (Enter/Space), and shows a visible focus ring (≥3:1); findings logged in `docs/pm/notes/a11y-manual-run-2026-06-22.md`.

## Tooling
- Framework: ESLint (`nx lint`), a Node contrast-check script, manual NVDA/VoiceOver + keyboard.
- Runner: `nx lint openbucket-frontend` + `nx build openbucket-frontend` (always-green CLI anchors); `node apps/openbucket-frontend/tools/contrast-check.mjs`.

## Pass criteria
- [ ] `nx lint openbucket-frontend` passes with the five a11y rules at `error`; `nx build openbucket-frontend` passes (Node 23).
- [ ] The contrast check passes for all 12 themes (light + dark).
- [ ] Cases 3–7 verified manually (NVDA/VoiceOver + keyboard); the manual-run note exists with no open blocking defect.

## References
- UX review 2026-06-22 (accessibility lens A11Y-3/4/5/6; F1–F12).
- STORY-0616 and TASK-1882..1888; WCAG 2.2 AA (1.3.1, 1.4.3, 1.4.11, 2.1.1, 2.3.3, 2.4.1, 2.4.3, 2.4.7, 4.1.2, 4.1.3).
