---
id: TEST-0425
title: BucketsSignalStore unit spec
covers: [STORY-0419, TASK-1257, TASK-1258]
status: backlog
level: unit
---

## Goal
Verify the signal store's read surface, loading toggling, and `create`/`remove` mutations against a stubbed `BucketsService`.

## Setup
- `TestBed.configureTestingModule({ providers: [{ provide: BucketsService, useValue: stub }] })`.
- `BucketsService.listBuckets() → of({ buckets: [...], total: ... })`, `createBucket(dto) → of({...})`, `deleteBucket(name) → of(void 0)`.

## Cases
1. Initial state: `items()` is `[]`, `loading()` is `false`, `error()` is `null`, `count() === 0`.
2. `refresh()` toggles `loading` true → false; on success `items()` equals stubbed buckets and `error()` stays null.
3. `refresh()` when the API throws → `error()` holds the error message and `loading()` is `false`.
4. `create(dto)` appends the returned bucket to `items()`; `count()` increments.
5. `remove('b1')` filters `b1` out of `items()`; `count()` decrements.
6. `items()` / `loading()` / `error()` are read-only signals — assigning to them is a TS compile error (verified via type-level assertion).

## Tooling
- Framework: jest + Angular `TestBed`
- Runner: `nx test frontend --testPathPattern=buckets.signal-store.spec.ts`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §5.15 (lines 8273–8321)
