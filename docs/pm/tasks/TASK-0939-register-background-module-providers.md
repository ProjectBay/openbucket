---
id: TASK-0939
title: Register BackgroundService and runner providers in BackgroundModule
story: STORY-0313
status: done
type: infra
size: XS
---

## Description
Create `apps/backend/src/common/background/background.module.ts` and register `BackgroundService`, `LifecycleSweepRunner`, `MultipartCleanupRunner`, `TrashPurgeRunner`, `OrphanScanRunner` as providers. Import dependencies from the persistence/domain modules.

## Files to create / modify
- `apps/backend/src/common/background/background.module.ts` — new
- `apps/backend/src/app.module.ts` — modify (import BackgroundModule)

## Implementation notes
- The module wires the four runner classes from [STORY-0314], [STORY-0315], [STORY-0316], [STORY-0317] as providers in addition to `BackgroundService` itself.
- Imports `ClockModule` from [STORY-0318] and the persistence/domain modules from EPIC-03.

## Acceptance criteria
- [ ] `BackgroundModule` exists and exports `BackgroundService`.
- [ ] All four runner classes are providers.
- [ ] `nx build backend` compiles after wiring.

## Test obligations
- Unit: covered by [TEST-0318]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0938]

## References
- `docs/WHITEPAPER.md` §4.9 (lines 6225–6261)
