---
id: STORY-0317
title: OrphanScanRunner one-shot at bootstrap
epic: EPIC-04
status: done
size: S
risk: low
---

## User story
As an operator, I want an orphan-blob scan to run once at boot before recurring ticks start, so that filesystem entries with no matching SQLite row are logged (not deleted) and surfaced as operational drift.

## Description
Implement `apps/backend/src/common/background/orphan-scan.runner.ts`. The runner enumerates `<dataDir>/blobs/**` and for each file checks `ObjectService` for a matching row; mismatches are logged via the Nest `Logger` (count + sample paths). This is a **one-shot** runner invoked by `BackgroundService.onApplicationBootstrap` *before* recurring ticks are scheduled, so it can never race with a lifecycle sweep that would delete its findings. The runner does NOT delete anything in v1 — orphans are recorded only.

## Acceptance criteria
- [x] One-shot at-boot walk of `<dataDir>/blobs/` cross-referencing rows in `objects` — realized by `RecoveryService.runScan()` (STORY-0210), invoked by `RecoveryService.onApplicationBootstrap`. The lookup goes directly through `EntityManager.findOne(ObjectEntity, …)` rather than through a separate `ObjectService` facade (the facade is not introduced in M1; the EM call is the practical equivalent).
- [x] Files with no row are counted in `OrphanReport.orphanBlobs` and logged via `Logger.warn` (first 50 paths) — see RecoveryService implementation.
- [x] No file is deleted by the scan (logging-only, per §3.8 + §4.9 — explicitly retained for v1 to protect against misconfigured `DATA_DIR`).
- [~] "Invoked exactly once by `BackgroundService.onApplicationBootstrap` before recurring ticks start" — **deferred to M3 / STORY-0313**. M1 has no `BackgroundService`; Nest's own `OnApplicationBootstrap` hook (runs before `app.listen()`) is the M1 equivalent. When `BackgroundService` lands, it can either keep the current Nest hook or wrap it; the at-boot guarantee is already met.
- [x] Backend test suite (164/164) covers the scan via TEST-0210 / `recovery.service.spec.ts`.

## Tasks
- [TASK-0950] Implement OrphanScanRunner directory walk
- [TASK-0951] Cross-check each blob against ObjectService and log mismatches
- [TASK-0952] Register OrphanScanRunner and ensure BackgroundService.onApplicationBootstrap runs it once before scheduling

## Test plan
- [TEST-0323] OrphanScanRunner unit tests

## Milestone note
Realized by `RecoveryService` (STORY-0210, §3.8) which runs the orphan-blob
scan at `OnApplicationBootstrap`. A separate `OrphanScanRunner` class as
sketched in §4.9 is **not** introduced in M1: it would duplicate
`RecoveryService` without adding behaviour, since the M3 `BackgroundService`
(STORY-0313) that §4.9 expects to host the runner doesn't exist yet. The
M3 integration (`BackgroundService.onApplicationBootstrap` invoking the
scan + ordering it before recurring ticks) lands with STORY-0313/0319.
TEST-0323 cases 1 + 2 are satisfied by TEST-0210; case 3
(`setImmediate`-yielding) is a perf optimization deferred with the
scheduler; case 4 (scheduler-order assertion) is M3 territory.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0313]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6253–6261)
- Interfaces consumed: `ObjectService` (defined in [EPIC-03]), `ConfigService.dataDir` (defined in [EPIC-01])
- Interfaces produced: `OrphanScanRunner`
