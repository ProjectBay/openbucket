---
id: TASK-0952
title: Register OrphanScanRunner and ensure bootstrap runs it before scheduling
story: STORY-0317
status: done
type: infra
size: XS
---

## Description
Add `OrphanScanRunner` to `BackgroundModule` providers. Confirm `BackgroundService.onApplicationBootstrap` awaits `runOnce('orphan-scan', ...)` BEFORE calling the three `schedule(...)` lines.

## Files to create / modify
- `apps/backend/src/common/background/background.module.ts` — modify

## Implementation notes
- Quote §4.9: "One-shot scans run *before* the recurring ticks start, so they can't race with a lifecycle sweep that might delete the orphans they log."

## Acceptance criteria
- [ ] `OrphanScanRunner` is a provider in `BackgroundModule`.
- [ ] In `onApplicationBootstrap`, `runOnce('orphan-scan', ...)` is awaited before any `schedule(...)` call.

## Test obligations
- Unit: covered by [TEST-0323]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0951], [TASK-0937]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6253–6261)
