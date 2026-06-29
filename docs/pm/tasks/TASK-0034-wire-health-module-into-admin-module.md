---
id: TASK-0034
title: Wire HealthModule and register in AdminModule
story: STORY-0012
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/admin/health/health.module.ts` declaring `HealthController` and importing the modules it depends on (`PersistenceModule`, `StorageModule`, the common shutdown providers). Import `HealthModule` into the EPIC-05 `AdminModule` placeholder so the controller is mounted.

## Files to create / modify
- `apps/openbucket-backend/src/admin/health/health.module.ts` — new
- `apps/openbucket-backend/src/admin/admin.module.ts` — modify (add `HealthModule` to imports)

## Implementation notes
- Per §1.1 (lines 90–91): `health/{health.controller.ts, health.module.ts}` lives under `apps/backend/src/admin/`.
- Suggested module shape:
  ```ts
  @Module({
    controllers: [HealthController],
  })
  export class HealthModule {}
  ```
- `BlobStoreHealth`, `MikroORM`, and `ShutdownState` are resolved from already-imported global modules (storage/persistence/common), so the health module needs only the controller.

## Acceptance criteria
- [ ] `HealthModule` exists and declares `HealthController` in `controllers`.
- [ ] `AdminModule` imports `HealthModule`.
- [ ] `nx build openbucket-backend` succeeds with both routes registered.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0013]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0002], [TASK-0032], [TASK-0033]

## References
- `docs/WHITEPAPER.md` §1.1 (lines 86–91); §1.8 (lines 818–871)
