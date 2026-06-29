---
id: TASK-1258
title: Refactor BucketListComponent to consume BucketsSignalStore
story: STORY-0419
status: done
type: refactor
size: XS
---

## Description
Replace direct `BucketsService` calls in `BucketListComponent` with `BucketsSignalStore`. Component reads `store.items()` and `store.loading()`; calls `store.refresh()` in `ngOnInit`.

## Files to create / modify
- `apps/frontend/src/app/buckets/bucket-list.component.ts` — modify

## Implementation notes
- Replace `inject(BucketsService)` with `inject(BucketsSignalStore)`.
- Replace local `buckets` / `loading` signals with `store.items` / `store.loading` read accessors.
- `ngOnInit` becomes `await store.refresh()`.
- Demonstrates the §5.15 invariant that the read surface (`items`, `loading`, `error`) is the canonical UI contract.

## Acceptance criteria
- [ ] Component no longer references `BucketsService` directly.
- [ ] Template binds to `store.items()` / `store.loading()`.
- [ ] `ngOnInit` calls `store.refresh()`.

## Test obligations
- Unit: covered by [TEST-0425]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1252], [TASK-1257]

## References
- `docs/WHITEPAPER.md` §5.15 (lines 8273–8321)
