---
id: TEST-0617
title: i18n completeness for feature screens
covers: [STORY-0617, TASK-1889, TASK-1890, TASK-1891, TASK-1892]
status: done
level: e2e
---

## Goal
Verify the whole console is translated: every user-facing string in the (re)built feature screens uses a translation key, switching to German translates them, `en`/`de` key sets are identical with no stale keys, and the "no hardcoded UI strings" convention (and optional lint guard) is in place.

## Setup
- Frontend on Node 23 (`nx serve openbucket-frontend`; `nx lint`/`nx build` for gates). Backend on Node 20 only if a live login walk-through is wanted.
- The locale switcher (Settings, `LocaleService` / `AppearanceStore`) to toggle `en` ↔ `de`.
- `ripgrep` (the Grep tooling) for the no-literal scan over feature templates.

## Cases
1. Given the buckets/objects/keys/auth/settings templates, when grepped for user-facing English literals, then none remain outside the `i18n/*.translations.ts` files (every string uses `| translate` or `translate.instant`).
2. Given the locale is switched to `de`, when walking buckets → objects → keys → auth → settings, then every label, button, table header, empty state, toast, and confirm dialog renders in German (no English leakage).
3. Given `en.translations.ts` and `de.translations.ts`, when their flattened key paths are compared, then the sets are identical (no `de` key missing, no orphan `en` key).
4. Given the previously stale keys `sidebar.content.pages` and `sidebar.content.routes`, when the files are inspected, then they are removed from both `en` and `de` (and any sidebar config referencing them).
5. Given a toast/confirm/empty-state/upload-summary is triggered in `de`, then its message renders in German (shared `common` group keys resolve).
6. Given the optional `@angular-eslint/template/i18n` guard, when `nx lint openbucket-frontend` runs, then it passes (rule at the documented level) and a new hardcoded literal would be flagged.

## Tooling
- Framework: ripgrep (no-literal scan), a small Node/diff check for en/de key-set equality, manual locale walk-through.
- Runner: `nx build openbucket-frontend` + `nx lint openbucket-frontend` (always-green CLI anchors); locale toggle in the running app for the manual cases.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Grep shows no hardcoded user-facing literals in the feature templates (case 1).
- [ ] `en` and `de` key sets are identical and stale keys are pruned (cases 3–4).
- [ ] Locale=`de` walk-through (cases 2, 5) shows full German with no English leakage; the convention doc exists (TASK-1892).

## References
- UX review 2026-06-22 (cross-cutting i18n notes from interaction + IA + power-user lenses).
- STORY-0617 and TASK-1889..1892; `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`.
