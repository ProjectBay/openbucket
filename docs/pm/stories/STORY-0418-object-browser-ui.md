---
id: STORY-0418
title: Object browser UI with prefix/delimiter pagination and uploads
epic: EPIC-05
status: done
size: M
risk: medium
---

## User story
As an admin user, I want the bucket detail page to host an object browser that paginates folders/objects with `prefix`+`delimiter='/'` and lets me upload files via drag-and-drop, so that I can navigate and populate buckets without leaving the SPA.

## Description
Implement the component tree from §5.14 under `apps/frontend/src/app/objects/`: `ObjectBrowserComponent` (route `/buckets/:name/browse`) hosting `ObjectBreadcrumbComponent`, `ObjectUploadComponent`, and a table of `ObjectRowComponent` rows. Pagination uses `marker` from the API; the component keeps an in-memory stack of `(prefix, marker)` tuples so back navigation works without a server round-trip. `ObjectUploadComponent` accepts drag-and-drop and file input; for each file, it `encodeURIComponent`s the key once and PUTs to `/api/admin/buckets/{bucket}/objects/{encodedKey}` with `reportProgress: true, observe: 'events'`. v1 deliberately uses the admin upload endpoint (same-origin, already authenticated) rather than presigned URLs.

## Acceptance criteria
- [ ] `ObjectBrowserComponent` exists as the lazy-loaded component for `/buckets/:name/browse`.
- [ ] Component tree includes `ObjectBreadcrumbComponent`, `ObjectUploadComponent`, `ObjectRowComponent`.
- [ ] Folder rows (common prefixes) set the prefix to `<currentPrefix><name>/` on click; object rows open a metadata side-panel.
- [ ] Back navigation walks an in-memory `(prefix, marker)` stack without hitting the server.
- [ ] `ObjectUploadComponent` PUTs to `/api/admin/buckets/{bucket}/objects/{encodedKey}` where `encodedKey = encodeURIComponent(prefix + file.name)` (encoded **exactly once**).
- [ ] Upload requests use `headers: { 'Content-Type': file.type || 'application/octet-stream' }`, `reportProgress: true`, `observe: 'events'`.
- [ ] Each upload exposes `{ id, name, progress, error? }` state in a signal-backed array.

## Tasks
- [TASK-1253] Implement `ObjectBrowserComponent` with prefix/marker stack
- [TASK-1254] Implement `ObjectBreadcrumbComponent`
- [TASK-1255] Implement `ObjectRowComponent` (folder vs object)
- [TASK-1256] Implement `ObjectUploadComponent` with single-encoding rule

## Test plan
- [TEST-0424] ObjectUploadComponent unit spec (encoding + progress events)

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0410], [STORY-0415], [STORY-0417]

## References
- `docs/WHITEPAPER.md` §5.14 (lines 8163–8272)
- Interfaces consumed: `ObjectsService` (EPIC-06 via STORY-0417), admin object endpoints (STORY-0410)
- Interfaces produced: `ObjectBrowserComponent`, `ObjectBreadcrumbComponent`, `ObjectRowComponent`, `ObjectUploadComponent`
