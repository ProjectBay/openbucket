---
id: TASK-0949
title: Register TrashPurgeRunner in BackgroundModule
story: STORY-0316
status: done
type: infra
size: XS
---

## Description
Add `TrashPurgeRunner` to `BackgroundModule` providers; `BackgroundService` already references it via constructor injection and schedules it at `5 * 60_000` ms.

## Files to create / modify
- `apps/backend/src/common/background/background.module.ts` — modify

## Implementation notes
- See §4.9 line 6249 (constructor) and line 6260 (schedule interval).

## Acceptance criteria
- [ ] `TrashPurgeRunner` is a provider in `BackgroundModule`.
- [ ] After bootstrap, `BackgroundService` schedules `trash-purge` at `5 * 60_000` ms.

## Test obligations
- Unit: covered by [TEST-0322]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0948], [TASK-0939]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6249, 6260)
