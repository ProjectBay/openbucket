---
id: TEST-0423
title: BucketListComponent unit spec (render + service interaction)
covers: [STORY-0417, TASK-1250, TASK-1252]
status: backlog
level: unit
---

## Goal
Verify `BucketListComponent` calls `BucketsService.listBuckets()` on init and renders the resulting list. Scope is intentionally narrow — full DOM and styling tests are out of scope.

## Setup
- `TestBed.configureTestingModule({ providers: [{ provide: BucketsService, useValue: stub }, provideApiClient()] })`.
- `BucketsService.listBuckets()` stub returns `of({ buckets: [{ name: 'a', objectCount: 1, sizeBytes: 100, createdAt: <iso> }], total: 1 })`.

## Cases
1. On `ngOnInit`, the component calls `BucketsService.listBuckets()` exactly once.
2. After init, `component.buckets()` equals the stubbed array.
3. `component.loading()` transitions from `true` to `false` after the API completes.
4. The rendered template contains a row with `a` and a `RouterLink` pointing to `['/buckets', 'a', 'browse']`.

## Tooling
- Framework: jest + Angular `TestBed`
- Runner: `nx test frontend --testPathPattern=bucket-list.component.spec.ts`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §5.13 (lines 8100–8160)
