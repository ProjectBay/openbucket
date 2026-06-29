---
id: TASK-1845
title: Build dashboard stat tiles from BucketsSignalStore aggregates
story: STORY-0609
status: done
type: implementation
size: M
---

## Description
Replace the `HomeComponent` "Replace this with real content" stub with a real overview that opens with three `hlmCard` stat tiles: total buckets, total objects, and total size. Derive the numbers from the data `BucketsSignalStore` already exposes (`items()` of `BucketSummaryDto`, each with `objectCount` and `sizeBytes`), formatting the size with `ByteSizePipe`. Keep the component OnPush and signal-driven.

## Files to create / modify
- `apps/openbucket-frontend/src/app/home/home.component.ts` — modify (replace template + add computed aggregates)

## Implementation notes
- `BucketsSignalStore` (`buckets/buckets.signal-store.ts`, `@Injectable({ providedIn: 'root' })`) exposes `readonly items`, `readonly loading`, `readonly error`, `readonly count = computed(() => this._items().length)`, and `async refresh()`. Inject it and call `refresh()` from the constructor (or an init effect) so the dashboard self-loads.
- `BucketSummaryDto` fields are `{ name, createdAt, versioning, objectLock, objectCount, sizeBytes }`. Add computeds:
  - `totalBuckets = this.store.count` (reuse the store's computed).
  - `totalObjects = computed(() => this.store.items().reduce((s, b) => s + b.objectCount, 0))`.
  - `totalSize = computed(() => this.store.items().reduce((s, b) => s + b.sizeBytes, 0))`.
- Tiles: import `HlmCardImports` from `@openbucket/spartan-ui/card`; each tile is an `[hlmCard]` with a `[hlmCardHeader]`/`[hlmCardDescription]` label and a large `[hlmCardContent]` value. Format the size with `ByteSizePipe` (`shared/ui/byte-size.pipe.ts`, pipe name `byteSize`): `{{ totalSize() | byteSize }}`.
- Keep `changeDetection: ChangeDetectionStrategy.OnPush` and the existing `pageHeader.setPageHeader('Dashboard', 'Your workspace overview')` call (TASK-1847 layers the action button on top).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] The dashboard renders three `hlmCard` tiles (buckets / objects / size); the size tile is formatted via `byteSize`.
- [ ] The totals match the bucket list (e.g. sum of `objectCount`/`sizeBytes` across `BucketsSignalStore.items()`).
- [ ] Component is OnPush; tiles update reactively when the store refreshes.

## Test obligations
- Unit: N/A (thin aggregation; verified via TEST-0609 manual).
- E2E: covered by [TEST-0609] (totals match the list).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0602], [STORY-0603]

## References
- UX review 2026-06-22 (IA B/F2 — no landing overview; dropped into a list).
- `apps/openbucket-frontend/src/app/home/home.component.ts`, `buckets/buckets.signal-store.ts` (`BucketsSignalStore`, `items`/`count`/`refresh`), `libs/api-client` (`BucketSummaryDto.objectCount`/`.sizeBytes`), `shared/ui/byte-size.pipe.ts` (`ByteSizePipe`, `byteSize`), `libs/ui/spartan/card`.
- Interfaces consumed: `BucketsSignalStore` (STORY-0603 implements/keeps it), `ByteSizePipe`.
