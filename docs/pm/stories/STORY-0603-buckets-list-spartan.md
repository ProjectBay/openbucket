---
id: STORY-0603
title: Buckets list on spartan-ng (create dialog, delete-confirm, badges, states)
epic: EPIC-07
status: done
size: M
risk: medium
---

## User story
As an admin, I want the buckets screen to use the design-system table, a proper create dialog, delete with confirmation, status badges, and real loading/empty states, so it looks and behaves like the rest of the console.

## Description
`bucket-list.component.ts` is raw `<table>` + raw `<button>`s + a hand-rolled `position:fixed` modal, with bare-text loading/empty states and no delete affordance (even though `BucketsSignalStore.remove()` is implemented and tested). Rebuild it on spartan-ng and wire it to the shared kit (STORY-0600).

## Acceptance criteria
- [ ] The table uses `HlmTableImports`; buttons use `hlmBtn` with consistent variants/sizes (no `px-3 py-1.5` vs `px-2 py-1` drift).
- [ ] Create-bucket uses `HlmDialog` (+ `hlm-input`, `hlm-switch` for versioning), with focus-trap/restore/Escape for free and inline name validation against the S3 rule; the hand-rolled modal is deleted and `bucket-create-dialog.component.ts` stub implemented.
- [ ] A per-row delete action opens the shared confirm dialog (type-to-confirm) → `store.remove()` → toast; the list refreshes.
- [ ] Loading shows `HlmSkeleton` rows (no layout shift); empty shows `hlm-empty` with a "Create bucket" CTA.
- [ ] Versioning/object-lock status shown as `hlmBadge`; create/delete success/error fire toasts.

## Tasks
- [TASK-1814] Convert the table (`bucket-list.component.ts:34-55`) to `HlmTableImports`; standardize buttons on `hlmBtn`; add `lucidePlus`/`lucideTrash` icons.
- [TASK-1815] Replace the hand-rolled modal (`:58-113`) with `HlmDialog` in `bucket-create-dialog.component.ts`; add inline name validation.
- [TASK-1816] Add row delete → `ConfirmDialogComponent` (type-to-confirm) → `BucketsSignalStore.remove()` + `notify`.
- [TASK-1817] Add `HlmSkeleton` loading + `hlm-empty` empty state with CTA.
- [TASK-1818] Add versioning/object-lock `hlmBadge` column; fire create/delete toasts; insert created bucket in sorted position.

## Test plan
- [TEST-0603] Unit (store create/remove) + e2e/manual: create via dialog (validation + focus), delete via confirm, badges render, skeleton/empty states show, toasts fire, all themes look correct.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0600]

## References
- UX review 2026-06-22 (design S2/S3/S5; interaction B/C; a11y A11Y-1; power-user F1).
- `apps/openbucket-frontend/src/app/buckets/{bucket-list,bucket-create-dialog,buckets.signal-store}.ts`, `libs/ui/spartan/{table,dialog,button,badge,skeleton,empty,input,switch}`.
