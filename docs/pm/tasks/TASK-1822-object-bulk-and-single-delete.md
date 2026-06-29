---
id: TASK-1822
title: Wire bulk delete to the batch-delete endpoint and add confirmed single-row delete
story: STORY-0604
status: done
type: implementation
size: M
---

## Description
Wire the bulk toolbar's "Delete selected" action to the admin batch-delete endpoint produced by STORY-0612, reporting the `{deleted, errors}` result via a `notify` toast, and add a single-row delete (from the row menu in TASK-1823) that goes through the shared confirm dialog. Both refresh the listing and clear/trim the selection afterward.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/objects.signal-store.ts` — implement/extend (currently `export {}`): add `bulkDelete(bucket, keys[])` and `remove(bucket, key)` over the regenerated client
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (wire toolbar Delete + single delete + result toast)

## Implementation notes
- Endpoint: STORY-0612 adds `POST /api/admin/buckets/:name/objects:batchDelete` with `BulkDeleteDto { keys[] }` → `BucketService.bulkDelete`, returning `{deleted[], errors[]}`. After STORY-0612 regenerates `@openbucket/api-client`, the generated `ObjectsAdminService` (or `BucketsAdminService`) will expose the batch-delete method — call it through `objects.signal-store.ts` (today the store is the `export {}` placeholder; implement the store rather than calling the generated service directly from the component, matching `BucketsSignalStore`'s pattern). Single delete uses the existing generated `ObjectsAdminService.deleteObject(name, path)`.
- Bulk flow: from the toolbar "Delete selected", open the shared `ConfirmDialogComponent` (STORY-0600, `destructive: true`, count in the description) → on confirm call `store.bulkDelete(bucket(), [...selection()])` → report via `notify`: success when `errors.length === 0` (e.g. `notify.success(deleted.length + ' objects deleted')`), otherwise `notify.error(...)` summarizing `{deleted, errors}` counts. Then re-list (`load()`) and clear the selection.
- Single flow: a "Delete" item in the per-row `HlmDropdownMenu` (TASK-1823) opens the confirm dialog for that one key → `store.remove(bucket(), key)` (wraps `ObjectsAdminService.deleteObject`) → `notify` → `load()` and remove the key from `selection()` if present.
- Use `firstValueFrom(...)` to await the Observables (the store pattern from `buckets.signal-store.ts`). Errors must surface as toasts, not be swallowed (this complements the `error` signal added in TASK-1824).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] "Delete selected" confirms, calls the batch-delete endpoint with the selected keys, and reports `{deleted, errors}` via a toast; the list refreshes and selection clears.
- [ ] A single-row "Delete" confirms and calls `deleteObject`, then refreshes; a toast reports success/failure.
- [ ] `objects.signal-store.ts` is no longer `export {}`; it exposes `bulkDelete` and `remove` (or equivalent) over the regenerated client.

## Test obligations
- Unit: covered by [TEST-0604] (store.bulkDelete maps result to toast summary; remove calls deleteObject; selection trimmed).
- E2E: covered by [TEST-0604] (manual — select N, bulk delete, partial-error toast; single delete from menu).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0612] (batch-delete endpoint), [TASK-1821]

## References
- UX review 2026-06-22 (power-user F1-F5 bulk ops; interaction C destructive confirmation).
- STORY-0612 (`POST :name/objects:batchDelete`, `BulkDeleteDto {keys[]}` → `{deleted[], errors[]}`), `apps/openbucket-frontend/src/app/objects/objects.signal-store.ts`, `object-browser.component.ts`, `libs/api-client/src/lib/api/objects-admin.service.ts` (`deleteObject`), `shared/ui/{confirm-dialog.component,notify}.ts` (STORY-0600).
