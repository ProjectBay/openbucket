---
id: TASK-1200
title: Scaffold admin directory tree and empty feature module placeholders
story: STORY-0400
status: done
type: infra
size: S
---

## Description
Create the admin directory layout shown at the top of §5.1 with empty `@Module({})` placeholder files for the five feature modules. No business logic yet — placeholders only so `AdminModule.imports` compiles.

## Files to create / modify
- `apps/backend/src/admin/auth/auth.module.ts` — new (empty `@Module({})`)
- `apps/backend/src/admin/buckets/buckets-admin.module.ts` — new
- `apps/backend/src/admin/objects/objects-admin.module.ts` — new
- `apps/backend/src/admin/keys/keys-admin.module.ts` — new
- `apps/backend/src/admin/settings/settings-admin.module.ts` — new
- `apps/backend/src/admin/audit/.gitkeep`, `apps/backend/src/admin/bootstrap/.gitkeep` — new

## Implementation notes
- Reproduce the exact directory tree from §5.1:
  ```
  apps/backend/src/admin/
    admin.module.ts
    auth/ { auth.module.ts, auth.controller.ts, auth.service.ts, jwt-auth.guard.ts,
             jwt.strategy.ts, refresh-token.service.ts, dto/ }
    buckets/ { buckets-admin.module.ts, buckets-admin.controller.ts, dto/ }
    objects/ { objects-admin.module.ts, objects-admin.controller.ts, dto/ }
    keys/ { keys-admin.module.ts, keys-admin.controller.ts, dto/ }
    settings/ { settings-admin.module.ts, settings-admin.controller.ts, dto/ }
    audit/ { audit.service.ts }
    bootstrap/ { admin-bootstrap.service.ts }
  ```
- Each placeholder module file is exactly `@Module({}) export class FooModule {}`.

## Acceptance criteria
- [ ] All five feature module files exist as compilable placeholders.
- [ ] `nx build backend` succeeds.

## Test obligations
- Unit: covered by [TEST-0400]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §5.1 (lines 6667–6716)
