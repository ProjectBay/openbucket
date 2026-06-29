---
id: TEST-0400
title: AdminModule wiring unit spec
covers: [STORY-0400, TASK-1200, TASK-1201]
status: done
level: unit
---

## Goal
Verify that `AdminModule` composes the five feature modules, binds `JwtAuthGuard` globally, and exports `AuditService`.

## Setup
- Nest `TestingModule.createTestingModule({ imports: [AdminModule] })` with stub `ConfigService` providing a fake `JWT_SECRET`.
- Mock `PersistenceModule` providers (`AdminUserRepository`, `RefreshTokenRepository`).

## Cases
1. Given the `AdminModule` is compiled, when we resolve `AuditService`, then the instance is non-null and equals the one exported.
2. Given the `AdminModule` is compiled, when we ask for the application's `APP_GUARD` providers, then `JwtAuthGuard` is among them.
3. Given the `AdminModule` is compiled, when we resolve each of `AuthModule`, `BucketsAdminModule`, `ObjectsAdminModule`, `KeysAdminModule`, `SettingsAdminModule`, then all resolve without error.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=admin.module.spec.ts`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §5.1 (lines 6667–6759)
