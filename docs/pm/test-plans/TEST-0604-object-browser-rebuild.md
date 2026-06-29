---
id: TEST-0604
title: Object browser rebuild — spartan table, multi-select, bulk delete, row actions, sheet
covers: [STORY-0604, TASK-1819, TASK-1820, TASK-1821, TASK-1822, TASK-1823, TASK-1824]
status: done
level: unit
---

## Goal
Verify the rebuilt object browser: a dense design-system table, keyboard-operable rows, a working selection model + bulk toolbar, bulk/single delete against the batch-delete endpoint, a per-row actions menu, a side-sheet detail panel, and surfaced errors — staying responsive on large listings.

## Setup
- Frontend unit harness: `jest-preset-angular` (Node 23). If the frontend jest project is not yet wired, treat the unit cases as build-verified and run the behavioral cases manually in `nx serve openbucket-frontend`.
- A bucket populated with enough objects + common prefixes (folders) to exercise paging (`limit 100`), plus an image object for the preview case. Backend (or mocked `ObjectsAdminService`) must serve `listObjects(name, prefix, '/', marker, 100)`, `getObject(name, path)`, the `?content`/`?download` endpoints, `deleteObject`, and the STORY-0612 batch-delete endpoint (`POST :name/objects:batchDelete` → `{deleted, errors}`).
- A way to induce a failing list/HEAD/download (e.g. 500 or offline) for the error cases.

## Cases
1. Given the browser loads, then the listing renders via `hlmTable`/`hlmTr`/`hlmTh`/`hlmTd` (no raw `<table>`); Size is right-aligned, a Storage-Class column shows `ObjectListItem.storageClass`, ETag is monospace, long keys truncate with a tooltip; both components are `OnPush`. (TASK-1819)
2. Given keyboard focus on a row's open control, when Enter or Space is pressed, then the folder navigates / the object opens (no host-`(click)` `<tr>`); folder rows show `lucideFolder` + an `sr-only` "Folder:" label (no `📁`). (TASK-1820)
3. Given the header select-all checkbox, when toggled, then all object rows select/clear (folders never selectable); partial selection shows indeterminate; per-row `HlmCheckbox` toggles `selection()` immutably and has an `aria-label`; clicking a checkbox does not open the object; navigating prefix/page clears selection. (TASK-1821)
4. Given a selection, then the bulk toolbar appears with the count + Delete/Download; "Delete selected" confirms, calls the batch-delete endpoint, and reports `{deleted, errors}` via toast; list refreshes and selection clears. (TASK-1822)
5. Given a row's `HlmDropdownMenu`, then Copy key, Copy URL, Download, Delete, View details all work; copy writes the clipboard + "Copied" toast; the copied URL equals the app's `?content` URL; single Delete confirms then refreshes. (TASK-1822, TASK-1823)
6. Given "View details" or row-open, then metadata + image preview + download render in an `HlmSheet` that slides over without pushing the table; closing clears preview + selection. (TASK-1824)
7. Given an induced list failure, then the `error` signal sets, an inline error shows, and an error toast fires (no silent `try/finally`); a failed HEAD/download surfaces via toast. (TASK-1824)
8. Given a large listing, then scrolling/paging stays responsive (`OnPush` + `@for track`). (TASK-1819)

## Tooling
- Framework: jest (`@testing-library/angular` optional) + manual keyboard/screen-reader.
- Runner: `nx test openbucket-frontend --testPathPatterns=objects` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Cases 1–8 verified (unit where the harness runs; otherwise manual in `nx serve`).
- [ ] No host-`(click)` `<tr>`, no `📁` emoji, no silent `try/finally` swallowing list/HEAD/download errors remain.

## References
- UX review 2026-06-22 (power-user A/F1-F5; a11y A11Y-2; design S2; interaction).
- STORY-0604 and TASK-1819..1824; STORY-0600 shared kit (`notify`, `ConfirmDialogComponent`, `CopyButtonComponent`); STORY-0612 batch-delete endpoint.
