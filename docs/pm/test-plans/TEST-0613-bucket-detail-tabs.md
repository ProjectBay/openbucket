---
id: TEST-0613
title: Bucket-detail tabbed page — tabs load/persist config, deep-links, empty states, toasts, list badges
covers: [STORY-0613, TASK-1867, TASK-1868, TASK-1869, TASK-1870, TASK-1871, TASK-1872]
status: done
level: e2e
---

## Goal
Verify the bucket-detail tabbed page reads and persists every bucket config feature through the admin API, that tabs honor `AppearanceStore.tabsVariant` and deep-link via `?tab=`, that unconfigured features show empty states, that saves toast, that destructive clears confirm, and that the bucket list links to the detail page and shows status badges.

## Setup
- Frontend on **Node 23** (Angular build/serve fail on Node 20 — `[[project_frontend_node23_build]]`). The backend it talks to runs on Node 20.
- Frontend unit harness: `jest-preset-angular` (run on Node 23). If the frontend jest project is not yet wired, treat the unit cases as build-verified (`nx build` + `nx lint` as the always-green CLI anchors) and run the behavioral cases manually in `nx serve openbucket-frontend` against a booted backend, or via Playwright.
- A booted backend with the STORY-0612 admin endpoints + a regenerated `@openbucket/api-client`; seed a bucket with some objects, plus a versioned bucket for the versioning case.

## Cases
1. Given `/buckets/:name`, when it loads, then all eight tabs render (Objects/Properties/Versioning/Encryption/Tags/Lifecycle/CORS/Policy) and the tab bar reflects `AppearanceStore.tabsVariant` (`default` vs `line`). [TASK-1867]
2. Given `/buckets/:name?tab=lifecycle`, when opened directly, then the Lifecycle tab is active; switching tabs updates `?tab=`; browser back/forward navigates tabs; `PageHeaderService.hasTabs()` is true. [TASK-1867]
3. Given the Versioning tab, when toggling the `hlm-switch`, then `putBucketVersioning` is called, a success toast fires, and a reload shows the persisted state (Enabled↔Suspended; no Disabled transition). [TASK-1868]
4. Given the Encryption tab, when toggling default encryption on/off, then `put`/`deleteBucketEncryption` round-trips and the off state shows `hlm-empty`; the object-lock badge reflects `getBucketObjectLock` (404 → Disabled). [TASK-1868]
5. Given the Tags tab, when adding rows + Save, then `putBucketTagging` persists and a toast fires; an untagged bucket shows `hlm-empty`; removing all rows + Save calls `deleteBucketTagging`. [TASK-1869]
6. Given the Lifecycle tab, when adding a rule + Save, then `putBucketLifecycle` persists; emptying all rules + Save calls `deleteBucketLifecycle` (not an empty `put`); an incomplete rule is rejected before submit. [TASK-1870]
7. Given the CORS/Policy tabs, when editing valid JSON + Save, then `putBucketCors`/`putBucketPolicy` persists; invalid JSON is caught client-side (no API call + error toast); "Clear" prompts the confirm dialog before `delete*`. [TASK-1871]
8. Given the bucket list, when clicking a bucket name, then it navigates to `/buckets/:name` (the tabbed detail, not `…/browse`); rows show versioning + object-lock badges from `BucketSummaryDto`; tab labels + badges resolve via i18n keys in every locale. [TASK-1872]

## Tooling
- Framework: jest + `@testing-library/angular` (optional, if harness wired) for unit; Playwright or manual `nx serve` for the e2e tab/persist/deep-link cases.
- Runner: `nx test openbucket-frontend --testPathPatterns=bucket-detail` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` + `nx lint openbucket-frontend` (Node 23) pass.
- [ ] Cases 1–8 verified (unit where the harness runs; otherwise manual/Playwright against a booted backend).
- [ ] Validation errors surface as toasts mapped from the backend 400 ValidationFailed (`[[project_admin_api_spec_drift]]`), not raw errors.

## References
- STORY-0613 and TASK-1867..1872.
- `apps/openbucket-frontend/src/app/buckets/{bucket-detail,bucket-list}.component.ts`, `app.routes.ts`, `libs/ui/spartan/{tabs,switch,badge,textarea,empty}`, `libs/api-client` (STORY-0612 endpoints), `core/platform/common/appearance/store/appearance.store.ts` (`tabsVariant`), `layout/shell/services/page-header.service.ts`, `shared/ui/{notify.ts,confirm-dialog.component.ts}`.
- See `[[project_frontend_node23_build]]`, `[[project_admin_api_spec_drift]]`.
