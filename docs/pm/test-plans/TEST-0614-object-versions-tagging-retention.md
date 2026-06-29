---
id: TEST-0614
title: Object versions, tagging & retention UI
covers: [STORY-0614, TASK-1873, TASK-1874, TASK-1875, TASK-1876, TASK-1877]
status: done
level: e2e
---

## Goal
Verify the object detail sheet's Versions, Tags, and Retention sections work end-to-end against a versioning- and object-lock-enabled bucket: versions and delete markers list with per-version Download/Delete, tags round-trip, retention/legal-hold respect compliance vs. governance, every string is translated, and toasts fire.

## Setup
- Frontend on Node 23 (`nx serve openbucket-frontend`) against a booted backend on Node 20 (the two have opposite Node requirements). Frontend unit harness is `jest-preset-angular`; if the frontend jest project is not yet wired, treat unit cases as build-verified and run the behavioral cases manually.
- A bucket with versioning enabled and a second bucket with object-lock enabled (one COMPLIANCE-mode object, one GOVERNANCE-mode object), seeded via the S3 layer / admin endpoints.
- `@openbucket/api-client` regenerated with the STORY-0612 endpoints (`listObjectVersions`, tagging, retention, legal-hold).

## Cases
1. Given a versioned object, when the Versions tab opens, then versions + delete markers list with id/size/lastModified and a Latest indicator; an unversioned bucket shows the empty state.
2. Given a version row, when Download is clicked, then that version's bytes download; when Delete is clicked, then a destructive confirm appears and confirming deletes that version, refreshes the list, and fires a success toast.
3. Given the Tags tab, when a key/value is added and saved, then `putObjectTagging` persists it and re-opening the sheet shows it; `userMetadata` renders read-only; duplicate/empty keys are rejected before the request.
4. Given an object-lock object in COMPLIANCE mode, then retention controls are read-only and a shorten attempt is rejected with an error toast; a GOVERNANCE object allows retention + legal-hold edits that persist with a toast.
5. Given the bucket has no object lock, then the Retention panel shows its "lock disabled" empty state and is not editable.
6. Given the locale is switched to `de`, when the sheet is opened, then all versions/tags/retention strings render in German with no hardcoded English.

## Tooling
- Framework: jest (`@testing-library/angular` optional) for unit; manual + (where wired) Playwright/e2e for the round-trip cases; screen reader for the icon-only action a11y check.
- Runner: `nx test openbucket-frontend --testPathPatterns=objects` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–6 verified (unit where the harness runs; otherwise manual/e2e).
- [ ] Per-version Download/Delete buttons expose `aria-label`; all list/save/delete failures surface a toast (no silent `try/finally`).

## References
- UX review 2026-06-22 (power-user E; feature-gap table).
- STORY-0614 and TASK-1873..1877; `@openbucket/api-client` endpoints from STORY-0612.
