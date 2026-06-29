---
id: TEST-0601
title: App-shell cleanup — brand, unified page header, Home icon, account menu
covers: [STORY-0601, TASK-1804, TASK-1805, TASK-1806, TASK-1807, TASK-1808]
status: done
level: e2e
---

## Goal
Verify the app shell is coherent and dead-code-free: the dead `shared/layout` tree is gone, one `ob-brand` (canonical "OpenBucket") replaces the triplicated brand, the page title and action button render identically across inset/sticky/compact, the Home/Dashboard icon is visible, and the sidebar footer account menu logs out.

## Setup
- Frontend unit/behavioral harness: `jest-preset-angular` (run on Node 23 — opposite of the backend's Node 20). If the frontend jest project is not yet wired, treat the unit cases as build-verified and run the behavioral cases manually in `nx serve openbucket-frontend`.
- A running backend admin API for the logout case (`/api/admin/auth/logout`, `/me`), or a mocked `AuthService`.
- Exercise each shell variant by switching `ShellLayoutService.variant()` (inset / sticky / compact) in the running app.

## Cases
1. Given the deletion of `shared/layout/*` (TASK-1804), when building, then `nx build openbucket-frontend` succeeds and `grep -r "shared/layout"` / `grep -r "ShellComponent"` over `apps/openbucket-frontend/src` return no hits; the STORY-0415 comment is gone from `app.routes.ts`.
2. Given `ob-brand` (TASK-1805), when each of the three sidebars renders, then the wordmark reads exactly `OpenBucket` and the mark is inline SVG using `currentColor`; the three variants are visually equivalent.
3. Given the unified header (TASK-1806), when the same page loads in inset, sticky and compact, then the title renders at one size via one component and is the same height; no variant shows a different title size/placement.
4. Given `PageHeaderService.setActionButton(label, cb)` and `showAction() === true`, when the header renders in each variant, then the action button appears (not only compact) and clicking it calls `executeAction()`/the callback.
5. Given the Home/Dashboard nav item (`icon: 'lucideHouse'`, TASK-1807), when the sidebar renders, then a visible icon appears; every `icon:` in `sidebar.data.ts` has a `provideIcons` registration and no registered icon is unused.
6. Given the account menu (TASK-1808), when opened in each variant, then it shows `AuthService.username()` + avatar; clicking Logout calls `AuthService.logout()` and navigates to `/login`; exactly one account trigger renders per variant.

## Tooling
- Framework: jest (`@testing-library/angular` optional) + manual browser walkthrough.
- Runner: `nx test openbucket-frontend --testPathPatterns=layout` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass with no unused-import / dead-file warnings.
- [ ] Cases 1–6 verified (unit where the harness runs; otherwise manual across all three variants).

## References
- UX review 2026-06-22 (design lens F8/F9/F10/F11/F12; IA lens F5).
- STORY-0601 and TASK-1804..1808.
