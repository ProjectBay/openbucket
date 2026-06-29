---
id: TEST-0323
title: OrphanScanRunner unit tests
covers: [STORY-0317, TASK-0950, TASK-0951, TASK-0952]
status: done
level: unit
---

## Goal
Verify the one-shot orphan scan walks `<dataDir>/blobs/`, identifies files with no matching row, logs them (up to the cap), does not delete anything, and is invoked before recurring ticks are scheduled.

## Setup
- Real fs/promises against an OS temp `dataDir` with a curated mix of "known" and "orphan" blob files.
- Mock `ObjectService` lookup so half the files have a matching row.

## Cases
1. Given 10 known blobs and 3 orphans, when `run()` returns, then 3 `Logger.warn` lines were emitted (or a single summary with count 3).
2. No file on disk is deleted by the runner.
3. The walker yields between subdirectories (spy on `setImmediate`).
4. `BackgroundService.onApplicationBootstrap` awaits `orphans.run()` before scheduling any of the recurring ticks (covered as a cross-spec assertion; can also live in [TEST-0318]).

## Tooling
- Framework: jest, fs/promises
- Runner: `nx test backend --testPathPattern=orphan-scan.runner.spec.ts`

## Pass criteria
- [x] Cases 1 + 2 satisfied by TEST-0210 (`recovery.service.spec.ts`): orphans counted + warn-logged, no file deleted.
- [ ] Case 3 (`setImmediate` yielding between subdirectories) — **deferred to M3**: perf optimization tied to the `BackgroundService` (STORY-0313) the runner would live in; M1's RecoveryService runs once at boot under no concurrent traffic.
- [ ] Case 4 (`BackgroundService.onApplicationBootstrap` schedules ticks *after* the scan) — **deferred to M3**: no `BackgroundService` exists in M1. Nest's `OnApplicationBootstrap` hook already runs `RecoveryService.runScan()` before `app.listen()`.

## Realization note
The §4.9 standalone `OrphanScanRunner` is folded into `RecoveryService`
(STORY-0210, §3.8) for M1 — same scan, same boot timing, fewer classes. The
M3 wrap into `BackgroundService` lands with STORY-0313/0319.

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6253–6261), glossary "Orphan blob"
