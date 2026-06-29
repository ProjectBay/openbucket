---
id: TEST-0609
title: Dashboard / home overview — tiles, recent buckets, quick actions, empty state
covers: [STORY-0609, TASK-1845, TASK-1846, TASK-1847, TASK-1848]
status: done
level: e2e
---

## Goal
Verify the dashboard is a real overview: stat tiles match the bucket list, recent-bucket links resolve to the right detail routes, quick actions and the header "Create" action open the correct dialogs, and a fresh instance shows the `hlm-empty` onboarding state — all OnPush/signal-driven and localized.

## Setup
- Frontend on Node 23. Backend admin API reachable so `BucketsSignalStore.refresh()` returns real buckets; a separate fresh instance (or a cleared store) for the empty-state case.
- Manual verification in `nx serve openbucket-frontend` (the dashboard is mostly thin aggregation + routing); `nx build`/`nx lint` as the always-green anchors.

## Cases
1. Given N buckets with known `objectCount`/`sizeBytes`, when the dashboard loads, then the three `hlmCard` tiles show total buckets = N, total objects = Σ objectCount, total size = Σ sizeBytes formatted via `byteSize`; the totals match the `/buckets` list.
2. Given recent buckets, when viewing the "Recent buckets" card, then up to 5 most-recently-created buckets are listed with a `relativeTime` of `createdAt` and `hlm-separator` rows; clicking one navigates to `/buckets/:name`.
3. Given the "Quick actions" card, when clicking "Create bucket" / "Create access key", then the bucket-create dialog / keys route (or key-create dialog) opens.
4. Given the dashboard, then the shell page header shows a "Create" action button (set via `PageHeaderService.setActionButton`) in inset/sticky/compact; clicking it opens create-bucket; navigating away clears it (no "Create" on other pages).
5. Given a fresh instance with zero buckets, when the dashboard loads, then an `hlm-empty` state with a "Create bucket" CTA is shown instead of zeroed tiles.
6. Given locale `de`, then tile labels, card titles, quick-action labels, and the empty state render German strings.

## Tooling
- Framework: manual e2e in the running app; Playwright optional if the frontend e2e project exists.
- Runner: manual `nx serve openbucket-frontend` / `nx e2e openbucket-frontend-e2e` (if present); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–6 verified.

## References
- UX review 2026-06-22 (IA B/F2).
- STORY-0609 and TASK-1845..1848.
