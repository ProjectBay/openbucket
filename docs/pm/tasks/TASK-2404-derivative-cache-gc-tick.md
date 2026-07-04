---
id: TASK-2404
title: Derivative-cache GC background tick and eviction
story: STORY-0800
status: backlog
type: implementation
size: M
---

## Description
Add a `DerivativeCacheGcRunner` that implements `ScheduledTask` and, on a recurring
tick, keeps the derivative store under `DERIVATIVE_CACHE_MAX_BYTES` by evicting the
least-recently-used entries, and reclaims entries orphaned by source overwrites
(whose ETag-derived key no longer matches any live source). This is what makes the
cache safe to leave unbounded in time: without it, a large key space of transform
params would grow the store without limit and eventually fill `DATA_DIR`.

## Files to create / modify
- `libs/nestjs/src/lib/common/background/derivative-cache-gc.runner.ts` — new: the runner.
- `libs/nestjs/src/lib/common/background/derivative-cache-gc.runner.spec.ts` — new.
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify: add
  `DerivativeCacheGcRunner` to `providers`, to the `SCHEDULED_TASKS` factory's
  `inject` list, and (transitively) it injects `DerivativeCacheService` +
  `AppConfigService` + `Clock` (StorageModule is already imported).
- `libs/nestjs/src/lib/storage/derivative-cache.service.ts` — modify (from TASK-2401):
  expose `listEntries()` (async iterator of `{ path, size, mtimeMs }`) and
  `evict(path)` helpers used by the runner.

## Implementation notes
- Model on `TrashPurgeRunner` (`trash-purge.runner.ts`): `readonly name`,
  `readonly intervalMs`, `run()`, inject `Clock` so tests fast-forward, batch +
  yield between batches, per-entry failure logged not fatal.
  ```ts
  readonly name = 'derivative-cache-gc';
  readonly intervalMs = 10 * 60_000; // 10 min
  ```
- `run()` algorithm (size-bounded LRU):
  1. If `derivativeCacheMaxBytes === 0`, return (unbounded — operator opt-in).
  2. Walk `derivatives/**` via `DerivativeCacheService.listEntries()`, summing `size`.
  3. If total `<= max`, return.
  4. Sort ascending by `mtimeMs` (LRU: oldest access first — cache reads should touch
     mtime via `fs.utimes` on hit, or accept mtime≈write time as an approximation and
     document it), and `evict()` from the oldest until total `<= max * 0.9` (evict to
     a low-water mark so GC does not run every tick right at the boundary).
  5. Evict = `fs.unlink` the derivative file; ignore ENOENT (idempotent, races with a
     concurrent regenerate are harmless since content is addressed).
- Orphan reclamation is implicit: an overwritten source produces a new ETag → new
  cache key → the old derivative is never requested again and ages out via LRU. No
  DB join needed (the derivative store has no back-reference to keys), which keeps the
  GC a pure filesystem sweep like `trash-purge`.
- Concurrency: eviction can race with an in-flight `put` (last-rename-wins) or a read
  (an open fd survives unlink on POSIX); both are safe. On the rare Windows unlink of
  an open file, ignore the EBUSY/EPERM and retry next tick.
- Register exactly like the other runners — the module comment in
  `background.module.ts` requires adding new runners to **both** `providers` and the
  factory `inject` list.
- Security/DoS: this is the backstop that turns "attacker inflates the cache with
  distinct `?w=` values" from a disk-fill DoS into a bounded, self-evicting store.
  Pair with `DERIVATIVE_CACHE_MAX_BYTES` (TASK-2403).
- Edge cases: `derivativesDir` absent (feature never used) → `run()` returns on
  ENOENT like `trash-purge.runner.ts`; empty dir → no-op; a huge single entry larger
  than `max` is still evicted (loop terminates).

## Acceptance criteria
- [ ] With `DERIVATIVE_CACHE_MAX_BYTES` set below the store's current size, one `run()`
      evicts oldest-mtime entries until the store is `<= 0.9 * max`.
- [ ] With total size under the cap, `run()` evicts nothing.
- [ ] `DERIVATIVE_CACHE_MAX_BYTES=0` short-circuits (no eviction).
- [ ] A missing `derivatives/` dir does not throw (ENOENT tolerated).
- [ ] The runner is discovered by `BackgroundService` (present in `SCHEDULED_TASKS`).
- [ ] `nx test nestjs --testPathPattern=derivative-cache-gc` passes.

## Test obligations
- Unit: covered by [TEST-0800] (LRU eviction to low-water mark, zero/absent-dir cases)
- E2E: covered by [TEST-0800] (cache stays bounded across many distinct transforms)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2401], [TASK-2403]

## References
- `libs/nestjs/src/lib/common/background/trash-purge.runner.ts` (ScheduledTask FS-sweep pattern).
- `libs/nestjs/src/lib/common/background/background.service.ts:15` (`ScheduledTask`), `:30` (`SCHEDULED_TASKS`).
- `libs/nestjs/src/lib/common/background/background.module.ts` (providers + inject-list wiring).
</content>
