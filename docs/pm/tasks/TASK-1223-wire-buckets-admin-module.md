---
id: TASK-1223
title: Wire BucketsAdminModule and register controller
story: STORY-0409
status: done
type: implementation
size: XS
---

## Description
Replace the placeholder `BucketsAdminModule` with a real module that registers `BucketsAdminController` and depends on the domain `BucketModule` / `ObjectModule` plus `AdminModule`'s exported `AuditService`.

## Files to create / modify
- `apps/backend/src/admin/buckets/buckets-admin.module.ts` — modify

## Implementation notes
- Module shape:
  ```ts
  @Module({
    imports: [BucketModule, ObjectModule],
    controllers: [BucketsAdminController],
  })
  export class BucketsAdminModule {}
  ```
- `AuditService` is already provided by `AdminModule` and exported, so the controller can inject it.

## Acceptance criteria
- [ ] Module compiles and is reachable from `AdminModule.imports`.
- [ ] `BucketsAdminController` is reachable at `/api/admin/buckets`.

## Test obligations
- Unit: covered by [TEST-0410]
- E2E: covered by [TEST-0411]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1222]

## References
- `docs/WHITEPAPER.md` §5.1 (lines 6685–6691), §5.5 (lines 7252–7272)
