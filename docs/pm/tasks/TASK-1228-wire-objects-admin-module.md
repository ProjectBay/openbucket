---
id: TASK-1228
title: Wire ObjectsAdminModule and register controller
story: STORY-0410
status: done
type: implementation
size: XS
---

## Description
Replace the placeholder `ObjectsAdminModule` with a real module that registers `ObjectsAdminController` and depends on the domain `ObjectModule`.

## Files to create / modify
- `apps/backend/src/admin/objects/objects-admin.module.ts` — modify

## Implementation notes
- Module shape:
  ```ts
  @Module({
    imports: [ObjectModule],
    controllers: [ObjectsAdminController],
  })
  export class ObjectsAdminModule {}
  ```

## Acceptance criteria
- [ ] Module compiles.
- [ ] Routes reachable at `/api/admin/buckets/:name/objects/...`.

## Test obligations
- Unit: covered by [TEST-0412]
- E2E: covered by [TEST-0413]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1227]

## References
- `docs/WHITEPAPER.md` §5.1 (lines 6692–6697)
