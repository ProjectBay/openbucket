---
id: TASK-1814
title: Convert the buckets table to HlmTableImports and standardize buttons on hlmBtn
story: STORY-0603
status: done
type: refactor
size: S
---

## Description
Replace the raw `<table>`/`<thead>`/`<tbody>` markup in `bucket-list.component.ts:34-55` with the design-system table (`HlmTableImports`) and replace the two raw `<button>` elements (the page-header "Create bucket" button at `:22-24` and any inline action buttons) with `hlmBtn`-attributed buttons using consistent variants/sizes. Add the `lucidePlus` and `lucideTrash2` icons so the create CTA and the per-row delete affordance (added in TASK-1816) share one icon set. This is the structural shell the other STORY-0603 tasks build on.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (swap table + buttons; add imports)

## Implementation notes
- Import the table set from `@openbucket/spartan-ui/table`: `HlmTableImports` is `[HlmCaption, HlmTableContainer, HlmTable, HlmTBody, HlmTd, HlmTFoot, HlmTh, HlmTHead, HlmTr]`. Apply `hlmTable` to the table, `hlmTr` to rows, `hlmTh` to headers, `hlmTd` to cells (attribute directives — keep the real `<table>`/`<tr>`/`<th>`/`<td>` elements for semantics).
- Buttons: import `HlmButtonImports` (exports `HlmButton`, `selector: '[hlmBtn]'`) from `@openbucket/spartan-ui/button`. The header CTA becomes `<button hlmBtn (click)="openCreate()">` — drop the hand-rolled `class="rounded bg-primary px-3 py-1.5 ..."`. Standardize on `hlmBtn` variants/sizes so the `px-3 py-1.5` vs `px-2 py-1` drift called out in the Story AC is gone.
- Icons: import `lucidePlus` and `lucideTrash2` from `@ng-icons/lucide`, register via `provideIcons({ lucidePlus, lucideTrash2 })` in the component `providers`, and render with `<ng-icon name="lucidePlus" />` (NgIcon) inside the buttons. Note the real symbol is `lucideTrash2` (not `lucideTrash`, which the Story bullet abbreviates).
- Keep the `RouterLink` to `['/buckets', b.name, 'browse']` on the name cell and the `ByteSizePipe`/`RelativeTimePipe` columns intact; only the wrapping elements change here.
- Component stays `standalone: true`, `selector: 'ob-bucket-list'`; reads continue from `BucketsSignalStore` (`store.items()`, `store.loading()`, `store.error()`, `store.count()`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (frontend builds on Node 23).
- [ ] No raw `<button class="rounded bg-primary ...">` remains in `bucket-list.component.ts`; every button carries `hlmBtn`.
- [ ] The table renders via `hlmTable`/`hlmTr`/`hlmTh`/`hlmTd` (no hand-rolled `class="w-full text-sm"` table) and `lucidePlus` shows in the create CTA.
- [ ] Existing columns (Name link, Objects, Size, Created) and routing to the object browser still work.

## Test obligations
- Unit: covered by [TEST-0603] (build/lint anchors; store reads unchanged).
- E2E: covered by [TEST-0603] (manual — table renders, CTA visible across themes).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600]

## References
- UX review 2026-06-22 (design lens S2 design-system table; S3 button consistency).
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts:22-55`, `libs/ui/spartan/table` (`HlmTableImports`), `libs/ui/spartan/button` (`HlmButton`, `[hlmBtn]`), `@ng-icons/lucide` (`lucidePlus`, `lucideTrash2`).
