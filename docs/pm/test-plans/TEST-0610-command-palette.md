---
id: TEST-0610
title: Command palette & keyboard shortcuts — open, filter, navigate, shortcuts, a11y
covers: [STORY-0610, TASK-1849, TASK-1850, TASK-1851, TASK-1852]
status: done
level: e2e
---

## Goal
Verify the ⌘K command palette opens across shell variants, filters across nav/buckets/actions groups, navigates/acts on selection, supports global shortcuts (`/`, `g b`, `g k`, `Esc`), exposes `hlm-kbd` hints, is openable from the brand ⌘ trigger, is localized, and is announced to screen readers.

## Setup
- Frontend on Node 23. Backend admin API reachable so the dynamic Buckets group (from `BucketsSignalStore`) populates.
- A screen reader (NVDA on Windows / VoiceOver) for the a11y case; test in all three shell variants (inset/sticky/compact via `AppearanceStore.setShellVariant`).
- Manual verification in `nx serve openbucket-frontend`; `nx build`/`nx lint` as the always-green anchors.

## Cases
1. Given any shell variant, when pressing ⌘K (mac) / Ctrl-K, then the palette opens; pressing Esc or selecting an item closes it.
2. Given the open palette, when typing, then items filter live across the Nav group (`sidebarConfig`), the dynamic Buckets group (`BucketsSignalStore.items()`), and the Actions group; an empty state shows when nothing matches.
3. Given a nav or bucket item, when selected, then the app navigates to the right route (`/buckets`, `/keys`, `/buckets/:name`); the palette closes.
4. Given the "Toggle theme" action, when selected, then `AppearanceStore` flips light↔dark; "Create bucket"/"Create access key" open the right flows.
5. Given focus outside any input, when pressing `/`, then the search field focuses; `g b` → Buckets, `g k` → Keys; `Esc` closes the palette. Shortcuts do NOT fire while typing in a normal input/textarea.
6. Given the palette/trigger, then `hlm-kbd` hints render (⌘K near the trigger; `g b`/`g k` via `HlmCommandShortcut`); clicking the brand ⌘ icon (in each variant) opens the palette and the trigger has an `aria-label`.
7. Given a screen reader, when the palette opens, then the dialog is announced; given locale `de`, palette labels/placeholder are German.

## Tooling
- Framework: manual e2e in the running app + manual screen-reader; Playwright optional if the frontend e2e project exists.
- Runner: manual `nx serve openbucket-frontend` / `nx e2e openbucket-frontend-e2e` (if present); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–7 verified.

## References
- UX review 2026-06-22 (IA E/F6; power-user F/F7).
- STORY-0610 and TASK-1849..1852.
