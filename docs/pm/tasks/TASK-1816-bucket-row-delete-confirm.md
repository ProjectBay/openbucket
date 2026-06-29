---
id: TASK-1816
title: Add per-row bucket delete via the shared confirm dialog (type-to-confirm)
story: STORY-0603
status: done
type: implementation
size: S
---

## Description
Add a per-row delete affordance to the buckets table. Clicking it opens the shared `ConfirmDialogComponent` (STORY-0600) in type-to-confirm mode — the operator must type the bucket name to enable the destructive Action — then calls `BucketsSignalStore.remove(name)` and fires a `notify` toast. The store already filters the removed bucket out of `items()`, so the list refreshes reactively; no manual re-fetch is needed.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (add a delete button per row + the confirm/remove handler)

## Implementation notes
- Render a destructive icon button in each row: `<button hlmBtn variant="ghost" size="icon-sm"><ng-icon name="lucideTrash2" /></button>` (icon registered in TASK-1814). Give it an `aria-label` like `"Delete bucket {{ b.name }}"`.
- Open the shared confirm dialog via `HlmDialogService.open(ConfirmDialogComponent, { context: {...} })` (or the component's documented open helper from STORY-0600). Pass `destructive: true`, a title/description naming the bucket, and the type-to-confirm phrase = `b.name` (TEST-0600 case 3: Action stays disabled until the input equals the phrase). `ConfirmDialogComponent` is produced by STORY-0600 (`shared/ui/confirm-dialog.component.ts`, currently an `export {}` stub).
- On confirm: `await store.remove(b.name)` (`BucketsSignalStore.remove(name)` calls `this.api.deleteBucket(name)` then `_items.update(arr => arr.filter(b => b.name !== name))`). Then `notify.success('Deleted bucket ' + b.name)`; on failure `notify.error(...)`. `notify` is the STORY-0600 helper (`shared/ui/notify.ts`).
- Do not call `store.refresh()` after delete — the store's `_items` filter already removes the row, so refetching would be a redundant round-trip.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Each bucket row shows a delete button with a descriptive `aria-label`.
- [ ] Clicking delete opens the confirm dialog; the Action button is disabled until the typed text equals the bucket name; confirming removes the row and a success toast fires.
- [ ] Cancel/Escape closes the dialog without calling `store.remove`.

## Test obligations
- Unit: covered by [TEST-0603] (store.remove filters items; confirm resolves true only on phrase match).
- E2E: covered by [TEST-0603] (manual — type-to-confirm gating, toast, row disappears).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1814]

## References
- UX review 2026-06-22 (interaction lens C destructive-action confirmation; power-user F1 row actions).
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts`, `buckets.signal-store.ts:42-45` (`remove`), `shared/ui/confirm-dialog.component.ts` (STORY-0600), `shared/ui/notify.ts` (STORY-0600), `libs/ui/spartan/{dialog,button}`, `@ng-icons/lucide` (`lucideTrash2`).
