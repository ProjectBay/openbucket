---
id: STORY-0400
title: Wire AdminModule tree and global JWT guard
epic: EPIC-05
status: done
size: S
risk: low
---

## User story
As a developer, I want `AdminModule` to import the five admin feature modules and register `JwtAuthGuard` as a global `APP_GUARD`, so that every `/api/admin/*` route is authenticated by default and feature modules can be added without rewiring auth.

## Description
Compose `apps/backend/src/admin/admin.module.ts` exactly as in §5.1.1: imports `AuthModule`, `BucketsAdminModule`, `ObjectsAdminModule`, `KeysAdminModule`, `SettingsAdminModule`, and `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])`. Providers include `{ provide: APP_GUARD, useClass: JwtAuthGuard }`, `AuditService`, and `AdminBootstrapService`. Exports `AuditService`. Also lay out the admin directory tree shown in §5.1 with empty module placeholder files for the five feature modules so subsequent Stories drop in.

## Acceptance criteria
- [x] `apps/backend/src/admin/admin.module.ts` exists and matches §5.1.1 verbatim (imports, providers, exports).
- [x] The directory tree under `apps/backend/src/admin/` matches §5.1 (`auth/`, `buckets/`, `objects/`, `keys/`, `settings/`, `audit/`, `bootstrap/`).
- [x] Empty `@Module({})` placeholders exist for `AuthModule`, `BucketsAdminModule`, `ObjectsAdminModule`, `KeysAdminModule`, `SettingsAdminModule` so the project compiles.
- [x] `JwtAuthGuard` is bound globally via `APP_GUARD`.
- [x] `nx build backend` succeeds.

## Tasks
- [TASK-1200] Scaffold admin directory tree and empty feature module placeholders
- [TASK-1201] Implement `admin.module.ts` with imports, providers, exports

## Test plan
- [TEST-0400] AdminModule wiring unit spec

## Dependencies
- Blocks: [STORY-0401], [STORY-0407], [STORY-0409], [STORY-0410], [STORY-0411], [STORY-0412], [STORY-0413]
- Blocked by: [EPIC-01] (`AppModule` composition root must accept `AdminModule`)

## References
- `docs/WHITEPAPER.md` §5.1 (lines 6667–6759)
- Interfaces produced: `AdminModule` (exports `AuditService`)
