---
id: TASK-1201
title: Implement admin.module.ts composition root
story: STORY-0400
status: done
type: implementation
size: XS
---

## Description
Compose `AdminModule` exactly as in §5.1.1: imports `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` plus the five feature modules, binds `JwtAuthGuard` globally via `APP_GUARD`, and provides + exports `AuditService` and `AdminBootstrapService`.

## Files to create / modify
- `apps/backend/src/admin/admin.module.ts` — new

## Implementation notes
- Verbatim from §5.1.1:
  ```ts
  @Module({
    imports: [
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
      AuthModule, BucketsAdminModule, ObjectsAdminModule,
      KeysAdminModule, SettingsAdminModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      AuditService,
      AdminBootstrapService,
    ],
    exports: [AuditService],
  })
  export class AdminModule {}
  ```
- Default throttler is **100/min per IP**; the login endpoint overrides to **5/min** (handled in AuthModule).
- `APP_GUARD` makes `JwtAuthGuard` global; login + refresh use `@Public()` to opt out.

## Acceptance criteria
- [ ] `admin.module.ts` matches §5.1.1 verbatim.
- [ ] `nx build backend` succeeds.
- [ ] Importing `AdminModule` from `AppModule` registers all five feature modules.

## Test obligations
- Unit: covered by [TEST-0400]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.1.1 (lines 6718–6757)
