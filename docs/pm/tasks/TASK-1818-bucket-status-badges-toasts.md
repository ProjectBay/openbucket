---
id: TASK-1818
title: Add versioning/object-lock badge column, create/delete toasts, and sorted insert
story: STORY-0603
status: done
type: implementation
size: S
---

## Description
Surface each bucket's versioning and object-lock status as `hlmBadge` chips in a new table column, fire `notify` toasts on create/delete success and error, and insert a newly created bucket in sorted position rather than appending. The badge column reads `BucketSummaryDto.versioning` and `BucketSummaryDto.objectLock`; the sorted insert improves on the store's current naive append.

## Files to create / modify
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts` — modify (add Status badge column; create/delete success toasts)
- `apps/openbucket-frontend/src/app/buckets/buckets.signal-store.ts` — modify (insert created bucket in sorted position)

## Implementation notes
- Badges: import `HlmBadgeImports` (`HlmBadge`, `selector: '[hlmBadge]'`, `variant` input: `'default' | 'secondary' | 'destructive' | 'outline'`) from `@openbucket/spartan-ui/badge`. Add a "Status" column showing versioning state from `BucketSummaryDto.versioning` (`BucketSummaryDtoVersioningEnum.Disabled | Enabled | Suspended`, values `'disabled' | 'enabled' | 'suspended'`) and an object-lock badge when `b.objectLock === true`. Map states to variants, e.g. `Enabled` → `variant="default"`, `Suspended` → `variant="secondary"`, `Disabled` → `variant="outline"`; object-lock → a `secondary`/`outline` "Object Lock" chip.
- Toasts: use `notify` (`shared/ui/notify.ts`, STORY-0600). On create success fire `notify.success('Created bucket ' + name)`; the create error path (the existing `messageFor()` 409/400/0 mapping) should additionally surface via `notify.error(...)`. Delete toasts are owned by TASK-1816; this task ensures the create side is covered and consistent.
- Sorted insert: in `BucketsSignalStore.create`, change `_items.update((arr) => [...arr, created])` to insert `created` into name-sorted position, e.g. `_items.update(arr => [...arr, created].sort((a, b) => a.name.localeCompare(b.name)))`, so a created bucket appears where it would after a refresh rather than at the end.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Each row shows a versioning badge (`hlmBadge`) reflecting `enabled`/`suspended`/`disabled`, and an "Object Lock" badge when `objectLock` is true.
- [ ] Creating a bucket fires a success toast; create errors fire an error toast in addition to the inline message.
- [ ] A newly created bucket lands in name-sorted position in `store.items()` (verifiable in the store unit test), not appended to the end.

## Test obligations
- Unit: covered by [TEST-0603] (store.create inserts in sorted order; badge variant mapping).
- E2E: covered by [TEST-0603] (manual — badges render across themes; toasts fire).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [TASK-1814]

## References
- UX review 2026-06-22 (design lens S2 status badges; interaction feedback toasts).
- `apps/openbucket-frontend/src/app/buckets/bucket-list.component.ts`, `buckets.signal-store.ts:37-40` (`create`), `libs/ui/spartan/badge` (`HlmBadge`, `BadgeVariants`), `@openbucket/api-client` (`BucketSummaryDto`, `BucketSummaryDtoVersioningEnum`), `shared/ui/notify.ts` (STORY-0600).
