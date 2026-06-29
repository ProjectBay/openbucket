---
id: TASK-1234
title: Wire KeysAdminModule and register controller
story: STORY-0411
status: done
type: implementation
size: XS
---

## Description
Replace the placeholder `KeysAdminModule` with a real module that registers `KeysAdminController` and depends on the domain `KeyModule`.

## Files to create / modify
- `apps/backend/src/admin/keys/keys-admin.module.ts` — modify

## Implementation notes
- Module shape:
  ```ts
  @Module({
    imports: [KeyModule],
    controllers: [KeysAdminController],
  })
  export class KeysAdminModule {}
  ```

## Acceptance criteria
- [ ] Module compiles.
- [ ] Routes reachable at `/api/admin/keys/...`.

## Test obligations
- Unit: covered by [TEST-0414]
- E2E: covered by [TEST-0415]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1233]

## References
- `docs/WHITEPAPER.md` §5.1 (lines 6699–6705)
