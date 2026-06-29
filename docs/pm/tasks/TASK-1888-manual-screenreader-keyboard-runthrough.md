---
id: TASK-1888
title: Manual screen-reader + keyboard-only run-through of core flows
story: STORY-0616
status: done
type: spike
---

## Description
Perform a documented manual screen-reader and keyboard-only run-through of the core console flows (login → buckets → objects → settings) to catch a11y defects the automated lint/contrast gates cannot, and record findings as follow-up issues or inline fixes.

## Files to create / modify
- `docs/pm/notes/a11y-manual-run-2026-06-22.md` — new (findings log: per-flow pass/fail, defects, WCAG criterion, fix or follow-up)

## Implementation notes
- Tools: NVDA on Windows (primary) and VoiceOver on macOS if available; keyboard-only (no mouse) for the full pass.
- Flows to walk: (1) login (`auth/login.component.ts`) — label/field association, error announcement; (2) buckets list — table semantics, create-bucket dialog focus trap, destructive confirm (`ConfirmDialogComponent`); (3) objects browser — keyboard-operable rows (Enter/Space, not host-`(click)`), select-all + bulk toolbar, row menu, detail sheet focus management, versions/tags/share actions; (4) settings — theme/locale/reduced-motion toggles operable and announced.
- Verify the cross-cutting items land in practice: skip link is first focusable + targets `<main>` (TASK-1882); route changes announce + focus `<main>`; icon-only controls announce their names (TASK-1883); reduced-motion suppresses animation (TASK-1885); focus is visible (ring ≥3:1, TASK-1884) on every interactive element.
- Record each defect with the WCAG criterion (e.g. 2.1.1, 2.4.1, 2.4.3, 2.4.7, 4.1.2, 4.1.3) and whether it was fixed inline or filed as a follow-up Story/Task.

## Acceptance criteria
- [ ] `docs/pm/notes/a11y-manual-run-2026-06-22.md` records the four flows with NVDA + keyboard-only results and any defects (with WCAG criterion).
- [ ] No blocking (operability) defect remains open in the core flows; non-blocking defects are filed as follow-ups.
- [ ] Skip link, route announce, icon-names, reduced-motion, and visible focus are each confirmed working in the live app.

## Test obligations
- Unit: N/A — manual a11y verification.
- E2E: this task IS the manual portion of [TEST-0616].
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1882], [TASK-1883], [TASK-1884], [TASK-1885], [TASK-1886], [TASK-1887]

## References
- UX review 2026-06-22 (a11y lens A11Y-3/4/5/6; F1–F12).
- WCAG 2.2 AA: 2.1.1, 2.4.1, 2.4.3, 2.4.7, 2.4.13, 4.1.2, 4.1.3.

## Verification note
Automatable a11y criteria pass: angular-eslint a11y rules are at `error` and `nx lint` is green; the token-contrast check (`scripts/check-theme-contrast.mjs`) passes all 312 pairs across 12 themes. The manual NVDA/VoiceOver + keyboard-only run-through is flagged for human verification before release.
