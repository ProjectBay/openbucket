---
id: TASK-1253
title: Implement ObjectBrowserComponent with prefix/marker stack
story: STORY-0418
status: done
type: implementation
size: M
---

## Description
The browser page hosted at `/buckets/:name/browse`. Renders breadcrumb, upload area, and rows; paginates with `marker` and tracks history client-side.

## Files to create / modify
- `apps/frontend/src/app/objects/object-browser.component.ts` — new

## Implementation notes
- Component tree per §5.14 (lines 8170–8177):
  ```
  ObjectBrowserComponent (route /buckets/:name/browse)
    ObjectBreadcrumbComponent          // prefix path: bucket > a > b > c
    ObjectUploadComponent              // drag-and-drop + button
    table
      ObjectRowComponent (one per common prefix or object)
  ```
- Pagination: §5.14 line 8179 — "The browser keeps a stack of `(prefix, marker)` tuples so the back button works without hitting the server."
- Use `ObjectsService` from `@openbucket/api-client`; pass `prefix`, `delimiter: '/'`, `marker`, `limit`.
- Folder-row click → set prefix to `<currentPrefix><name>/` and push current `(prefix, marker)` on the stack.
- Object-row click → open metadata side-panel via `ObjectsService` meta call.

## Acceptance criteria
- [ ] Component is standalone and uses signals for `prefix`, `marker`, `contents`, `commonPrefixes`, `isTruncated`, `historyStack`.
- [ ] Initial load uses `delimiter: '/'` and empty prefix.
- [ ] Folder click pushes current `(prefix, marker)` and sets new prefix.
- [ ] Back walks the in-memory stack without an API call.

## Test obligations
- Unit: N/A (component-test scope, deferred)
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1250], [TASK-1254], [TASK-1255], [TASK-1256]

## References
- `docs/WHITEPAPER.md` §5.14 (lines 8163–8181)
