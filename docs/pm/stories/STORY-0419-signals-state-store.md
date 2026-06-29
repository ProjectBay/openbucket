---
id: STORY-0419
title: Signal-based state store pattern
epic: EPIC-05
status: done
size: S
risk: low
---

## User story
As a developer, I want a tiny "signal store" pattern (services holding signals plus mutation methods), so that feature state stays read-only-shaped to components without pulling in NgRx for v1.

## Description
Establish the signal-store pattern from §5.15 by authoring `BucketsSignalStore` (`apps/frontend/src/app/buckets/buckets.signal-store.ts`). Internal mutable signals `_items`, `_loading`, `_error`; expose `items = _items.asReadonly()`, `loading`, `error`, and `count = computed(() => _items().length)`. Methods `refresh()`, `create(dto)`, `remove(name)` call `BucketsService` (from `@openbucket/api-client`) and update signals on success. Replace direct API calls in `BucketListComponent` with `BucketsSignalStore`. Note that NgRx SignalStore can replace this later without changing the read surface.

## Acceptance criteria
- [x] `BucketsSignalStore` is `@Injectable({ providedIn: 'root' })`.
- [x] Private signals: `_items: BucketSummaryDto[]`, `_loading: boolean`, `_error: string | null`.
- [x] Public read surface: `items`, `loading`, `error` (all `asReadonly()`), `count` (computed length).
- [x] `refresh()` toggles loading, awaits `api.listBuckets()`, sets `_items` to `res?.buckets ?? []`, captures error message on failure.
- [x] `create(dto)` calls `api.createBucket(dto)` and appends to `_items` on success.
- [x] `remove(name)` calls `api.deleteBucket(name)` and filters `_items`.
- [x] `BucketListComponent` consumes the store rather than `BucketsService` directly.

## Tasks
- [TASK-1257] Implement `BucketsSignalStore`
- [TASK-1258] Refactor `BucketListComponent` to use the store

## Test plan
- [TEST-0425] BucketsSignalStore unit spec

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0417]

## References
- `docs/WHITEPAPER.md` §5.15 (lines 8273–8324)
- Interfaces produced: `BucketsSignalStore`
- Interfaces consumed: `@openbucket/api-client::BucketsService` (EPIC-06)
