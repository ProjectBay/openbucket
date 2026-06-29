---
id: TEST-0602
title: Domain navigation, routing, breadcrumbs & 404 page
covers: [STORY-0602, TASK-1809, TASK-1810, TASK-1811, TASK-1812, TASK-1813]
status: done
level: e2e
---

## Goal
Verify the sidebar maps to the real domains with shareable URLs, the Dashboard index route resolves, breadcrumbs show real bucket names and meaningful labels, and unknown routes render a real 404 — across all three shell variants.

## Setup
- Frontend unit/behavioral harness: `jest-preset-angular` (run on Node 23 — opposite of the backend's Node 20). If the frontend jest project is not yet wired, treat the unit cases as build-verified and run the behavioral cases manually in `nx serve openbucket-frontend`.
- An authenticated admin session (guards `authGuard` + `mustNotRotateGuard` protect the shell routes).
- Exercise each shell variant via `ShellLayoutService.variant()` (inset / sticky / compact).

## Cases
1. Given the rewritten `sidebar.data.ts` (TASK-1809), when the sidebar renders, then it lists Dashboard, Buckets, Access Keys, Settings (in order) with translated `en`/`de` labels and the dead `#` Help item is gone; clicking each routes to `/`, `/buckets`, `/keys`, `/settings`.
2. Given the `home` index route (TASK-1810), when navigating to `/`, then `HomeComponent` renders within the shell (no redirect to `/buckets`) and the Dashboard nav item is active.
3. Given the breadcrumb fix (TASK-1811), when visiting `/buckets/my-bucket/browse`, then the trail reads `Buckets › my-bucket › Objects` — the real bucket name is present and static segments use their `data: { breadcrumb }` labels; no raw `:name` literal appears.
4. Given a deep link pasted into a fresh tab (`/buckets/my-bucket`), when it loads, then the breadcrumb still shows the bucket name (URL is shareable).
5. Given an unknown URL (e.g. `/does-not-exist`, TASK-1812), when it loads, then `NotFoundComponent` renders (not a redirect to `/buckets`) and its "back home" link routes to `/`.
6. Given the shared config/service (TASK-1813), when switching between inset, sticky and compact, then nav items and breadcrumbs render identically in every variant (no variant-specific regression).

## Tooling
- Framework: jest (`@testing-library/angular` optional) + manual browser walkthrough.
- Runner: `nx test openbucket-frontend --testPathPatterns="breadcrumb|routes"` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Cases 1–6 verified (unit where the harness runs; otherwise manual across all three variants).

## References
- UX review 2026-06-22 (IA lens F1/F2/F9/F10).
- STORY-0602 and TASK-1809..1813.
