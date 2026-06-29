---
id: TASK-1817
title: Add HlmSkeleton loading rows and hlm-empty empty state with CTA to the buckets list
story: STORY-0603
status: done
type: implementation
size: S
---

## Description
Replace the bare-text loading and empty states in `bucket-list.component.ts:27-32` (`<p>Loading…</p>` and `<p>No buckets yet.</p>`) with proper design-system states: `HlmSkeleton` rows that mirror the table layout while `store.loading()` is true (no layout shift), and an `hlm-empty` block with a "Create bucket" CTA when `store.count() === 0`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (loading/empty branches of the `@if` chain)

## Implementation notes
- Loading: import `HlmSkeletonImports` (`HlmSkeleton`, `selector: 'hlm-skeleton'`) from `@openbucket/spartan-ui/skeleton`. Render ~5 skeleton rows whose cell widths match the Name/Objects/Size/Created columns from TASK-1814 so swapping skeleton → data causes no reflow. Keep the table header visible during load so the layout is stable.
- Empty: import `HlmEmptyImports` (`HlmEmpty`, `HlmEmptyHeader`, `HlmEmptyTitle`, `HlmEmptyDescription`, `HlmEmptyContent`, `HlmEmptyMedia`) from `@openbucket/spartan-ui/empty`. Title e.g. "No buckets yet", description explaining buckets, and an `HlmEmptyContent` slot with a `<button hlmBtn>` "Create bucket" CTA wired to `openCreate()` (the same dialog opener as the header CTA from TASK-1815).
- Preserve the existing `@if (store.loading()) {...} @else if (store.error()) {...} @else if (store.count() === 0) {...} @else {table}` ordering; only the loading and empty branch bodies change. Leave the error branch (`store.error()`) as-is for this task.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] While loading, `hlm-skeleton` rows show in place of data with no visible layout shift when data arrives.
- [ ] With zero buckets, `hlm-empty` renders a title/description and a working "Create bucket" CTA that opens the create dialog.
- [ ] The bare `<p>Loading…</p>` and `<p>No buckets yet.</p>` text is gone.

## Test obligations
- Unit: covered by [TEST-0603] (build/lint anchors).
- E2E: covered by [TEST-0603] (manual — skeleton on slow load, empty-state CTA).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1814]

## References
- UX review 2026-06-22 (design lens S5 loading/empty states; interaction empty-state CTA).
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts:27-32`, `libs/ui/spartan/skeleton` (`HlmSkeletonImports`), `libs/ui/spartan/empty` (`HlmEmptyImports`), `libs/ui/spartan/button`.
