---
id: STORY-0605
title: Object listing UX — pagination, page-size, prefix search, counts, deep-link
epic: EPIC-07
status: done
size: M
risk: medium
---

## User story
As an operator, I want to choose page size, search by prefix, see object counts, and have the current folder live in the URL, so I can find things fast and bookmark/share/refresh into the same place.

## Description
Listing is forward/back-only with a hardcoded `limit=100`, no counts, no search, and an in-memory prefix/marker stack that resets on refresh (the folder is never written to the URL, so back/forward and bookmarking are broken). `withComponentInputBinding()` is already enabled, so a `?prefix=` query param binds with minimal plumbing.

## Acceptance criteria
- [ ] A page-size `HlmSelect` (25/50/100/250/1000) drives the `limit` arg of `listObjects`; default 100.
- [ ] A prefix-search `HlmInput` (focusable via `/`) jumps to a server-side prefix; a client-side filter narrows the current page via a `computed`.
- [ ] Bucket total `objectCount`/`sizeBytes` (from `BucketSummaryDto`) and "showing N (truncated)" are shown via the header/`hlmBadge`.
- [ ] The current `prefix` is a `?prefix=` query param (bound via component-input-binding); drilling into a folder pushes a real history entry; refresh restores position; in-app Back matches browser Back.
- [ ] Prev/next rendered with `HlmPagination` over the existing marker stack.

## Tasks
- [TASK-1825] Add page-size `HlmSelect` bound to `listObjects` `limit`.
- [TASK-1826] Add prefix-search `HlmInput` (+ `/` shortcut) and a client-side page filter (`computed`).
- [TASK-1827] Surface bucket `objectCount`/`sizeBytes` + truncation indicator in the header.
- [TASK-1828] Drive `prefix` from a `?prefix=` query param; `router.navigate` on folder open; seed from URL in `ngOnInit`.
- [TASK-1829] Replace back/next with `HlmPagination` over the marker stack.

## Test plan
- [TEST-0605] E2E/manual: change page size; prefix search; deep-link a folder (bookmark + refresh + browser Back); counts shown; filter narrows page.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0604]

## References
- UX review 2026-06-22 (power-user B/F3/F8; IA C/F7).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`, `app.config.ts` (`withComponentInputBinding`), `libs/ui/spartan/{select,input,pagination,badge}`, `libs/api-client/src/lib/api/objects-admin.service.ts`.
