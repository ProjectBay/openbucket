---
id: TEST-0603
title: Buckets list on spartan-ng — create dialog, delete-confirm, badges, states
covers: [STORY-0603, TASK-1814, TASK-1815, TASK-1816, TASK-1817, TASK-1818]
status: done
level: unit
---

## Goal
Verify the rebuilt buckets screen: the design-system table renders, the create dialog validates + traps focus, per-row delete is gated by type-to-confirm and fires a toast, loading/empty states use `HlmSkeleton`/`hlm-empty`, status badges reflect versioning/object-lock, and created buckets insert in sorted position — across all themes.

## Setup
- Frontend unit harness: `jest-preset-angular` (run on Node 23 — the frontend builds/tests on Node 23, opposite the backend's Node 20). If the frontend jest project is not yet wired, treat the unit cases as build-verified and run the behavioral cases manually in `nx serve openbucket-frontend`.
- A backend (or mocked `BucketsAdminService`) returning a few `BucketSummaryDto`s with mixed `versioning` (`enabled`/`suspended`/`disabled`) and `objectLock` values, plus one empty-list response for the empty-state case.
- Theme switcher exercised (light/dark + any brand themes) for the visual cases.

## Cases
1. Given the buckets route, when the list loads, then the table renders via `hlmTable`/`hlmTr`/`hlmTh`/`hlmTd` (no raw `<table class="w-full text-sm">`) and every button carries `hlmBtn` (no `px-3 py-1.5`/`px-2 py-1` drift). (TASK-1814)
2. Given the create dialog is opened, when an invalid S3 name is typed (e.g. `AB`, `My_Bucket`), then the Action button stays disabled with inline feedback; a valid name submits, calls `BucketsSignalStore.create` with the correct `versioning` enum, and the dialog closes. (TASK-1815)
3. Given the create dialog opens, then focus moves into it and Escape closes it (focus-trap/restore from `HlmDialog`); no `position:fixed` hand-rolled modal exists. (TASK-1815)
4. Given a row delete is clicked, when the confirm dialog opens in type-to-confirm mode, then the destructive Action is disabled until the input equals the bucket name; confirming calls `store.remove(name)`, the row disappears (store filters `_items`), and a success toast fires; Cancel/Escape does not call `remove`. (TASK-1816)
5. Given `store.loading()` is true, then `hlm-skeleton` rows show with no layout shift on data arrival; given zero buckets, `hlm-empty` shows a title/description and a working "Create bucket" CTA. (TASK-1817)
6. Given buckets with mixed status, then each row shows an `hlmBadge` for versioning (`enabled`/`suspended`/`disabled`) and an "Object Lock" badge when `objectLock` is true; create/delete fire success/error toasts. (TASK-1818)
7. Given a successful create, then `store.items()` contains the new bucket in name-sorted position (not appended last). (TASK-1818, store unit)

## Tooling
- Framework: jest (`@testing-library/angular` optional) + manual screen-reader/theme check.
- Runner: `nx test openbucket-frontend --testPathPatterns=buckets` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Cases 1–7 verified (unit where the harness runs; otherwise manual in `nx serve`).
- [ ] No hand-rolled modal, no bare-text loading/empty `<p>` strings, and no raw header `<button class="rounded bg-primary ...">` remain.

## References
- UX review 2026-06-22 (design S2/S3/S5; interaction B/C; a11y A11Y-1; power-user F1).
- STORY-0603 and TASK-1814..1818; shared kit from STORY-0600 (`notify`, `ConfirmDialogComponent`).
