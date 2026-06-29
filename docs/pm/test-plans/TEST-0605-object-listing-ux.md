---
id: TEST-0605
title: Object listing UX — page-size, prefix search, counts, deep-link, pagination
covers: [STORY-0605, TASK-1825, TASK-1826, TASK-1827, TASK-1828, TASK-1829]
status: done
level: e2e
---

## Goal
Verify the object browser lets operators control page size, search by prefix (server jump + client filter), see bucket counts/size and a truncation indicator, deep-link/bookmark/refresh into a folder via `?prefix=`, and page forward/back through a multi-page bucket using `HlmPagination`.

## Setup
- Frontend served against a running backend: `nx serve openbucket-frontend` (build/serve the frontend on Node 23 — opposite of the backend's Node 20). Backend running so `GET /api/admin/buckets/:name/objects` and `GET /api/admin/buckets/:name` respond.
- A bucket with > 1000 objects spread across at least two folder prefixes (so listings truncate and folders surface via delimiter `/`). Use `aws-cli`/`mc` to seed objects under e.g. `a/` and `b/` prefixes.
- Browser dev-tools Network panel open to distinguish server requests from client-only filtering.

## Cases
1. Page size: given the default 100, when the page-size `HlmSelect` is changed to 25/250/1000, then a new `listObjects` request issues with that `limit` and the page shows at most that many rows; changing size resets paging (Back disabled).
2. Prefix search (server): given the search input, when a prefix is submitted, then a `listObjects` request with that `prefix` issues and the listing jumps to that prefix.
3. Client filter: given a loaded page, when text is typed into the filter, then the visible rows narrow with NO new network request (verified in the Network panel); clearing restores the page.
4. Keyboard: given focus is not in a field, when `/` is pressed, then the search input receives focus.
5. Counts/truncation: given a large bucket, then the header shows the bucket's `objectCount` and human-readable `sizeBytes` (via `ByteSizePipe`), and a "(truncated)" indicator appears when the response `isTruncated`.
6. Deep-link: given a folder, when drilled into, then the URL becomes `...?prefix=<folder>/` with a new history entry; browser Back returns to the parent; refresh restores the same folder; opening the bookmarked URL lands directly in that folder.
7. Pagination: given a truncated listing, when Next/Prev are clicked in `HlmPagination`, then paging advances via `nextMarker` and returns; Prev is disabled on page 1 and Next is disabled when not truncated.

## Tooling
- Framework: manual/e2e in the browser (`@aws-sdk/client-s3` or `aws-cli`/`mc` to seed); jest only if/where the frontend harness is wired.
- Runner: `nx serve openbucket-frontend` for manual; `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–7 verified manually in the running app.

## References
- UX review 2026-06-22 (power-user B/F3/F8; IA C/F7).
- STORY-0605 and TASK-1825..1829; `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`.
