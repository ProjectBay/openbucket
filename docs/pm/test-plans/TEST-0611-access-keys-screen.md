---
id: TEST-0611
title: Access-keys management — store, list, create/secret-once, toggle/relabel/delete
covers: [STORY-0611, TASK-1853, TASK-1854, TASK-1855, TASK-1856, TASK-1857]
status: done
level: e2e
---

## Goal
Verify the access-keys screen lists, creates (with the secret shown exactly once + copyable), enables/disables, relabels, and deletes keys, with loading/empty states and toasts, backed by a `KeysSignalStore` that mirrors `BucketsSignalStore` over the real `KeysAdminService`.

## Setup
- Frontend on Node 23. Backend admin API reachable so `KeysAdminService.listKeys/createKey/updateKey/deleteKey` work end-to-end.
- Frontend unit harness: `jest-preset-angular` for the `KeysSignalStore` case (run on Node 23). If the frontend jest project is not wired, treat the store case as build-verified and run the behavioral cases manually in `nx serve openbucket-frontend`.
- A screen reader (NVDA/VoiceOver) for the secret-once focus/announcement case.

## Cases
1. (Unit) Given `KeysSignalStore`, when `refresh`/`create`/`update`/`remove` are called, then they invoke `KeysAdminService.listKeys`/`createKey`/`updateKey`/`deleteKey` and update `items` (create inserts and returns the full `CreatedKeyDto`; update replaces by `id`; remove filters by `id`).
2. Given the keys list, when loaded, then it renders `HlmTable` columns Label / Access Key ID (monospace + working copy-button) / Role (`hlmBadge`) / Last used (`relativeTime`, dash when `lastUsedAt` null) / Status (`hlm-switch`) / actions dropdown.
3. Given "Create access key", when submitting a label, then `createKey` runs, the secret-once dialog opens showing `accessKeyId` + `secretAccessKey` (each copyable) with a "won't be shown again" warning; focus lands on the secret; closing returns focus; a success toast fires; the new key appears in the list.
4. Given a key row, when toggling the Status switch, then `updateKey(id, { disabled })` runs and the row reflects the new state with a toast; relabeling updates the label.
5. Given a key row's Delete, when confirmed via the shared confirm dialog (type-to-confirm), then `deleteKey(id)` runs, the row is removed, and a toast fires.
6. Given the loading state, then `HlmSkeleton` rows show (no layout shift); given zero keys, an `hlm-empty` state with a "Create access key" CTA shows.
7. Given locale `de`, then the keys screen strings render in German.

## Tooling
- Framework: jest (`@testing-library/angular` optional) for the store unit case; manual/Playwright e2e + manual screen-reader for the rest.
- Runner: `nx test openbucket-frontend --testPathPatterns=keys` (if wired); manual `nx serve openbucket-frontend` / `nx e2e openbucket-frontend-e2e` (if present); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Case 1 passes as a unit test where the harness runs; Cases 2–7 verified (e2e where harnessed, otherwise manual).

## References
- UX review 2026-06-22 (power-user C/F6; IA F3; design).
- STORY-0611 and TASK-1853..1857.
