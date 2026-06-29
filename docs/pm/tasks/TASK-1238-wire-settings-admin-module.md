---
id: TASK-1238
title: Wire SettingsAdminModule and register controller
story: STORY-0412
status: done
type: implementation
size: XS
---

## Description
Replace the placeholder `SettingsAdminModule` with a real module that registers `SettingsAdminController` and imports `PersistenceModule` (for `AdminUserRepository`).

## Files to create / modify
- `apps/backend/src/admin/settings/settings-admin.module.ts` — modify

## Implementation notes
- Module shape:
  ```ts
  @Module({
    imports: [PersistenceModule],
    controllers: [SettingsAdminController],
  })
  export class SettingsAdminModule {}
  ```

## Acceptance criteria
- [ ] Module compiles.
- [ ] `/api/admin/settings/change-password` reachable.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0417]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1237]

## References
- `docs/WHITEPAPER.md` §5.1 (lines 6706–6711)
