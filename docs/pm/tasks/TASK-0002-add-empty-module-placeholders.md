---
id: TASK-0002
title: Add empty module placeholders for AppModule consumers
story: STORY-0001
status: done
type: infra
size: XS
---

## Description
Create empty `@Module({})` placeholder classes for the modules `AppModule` imports but whose bodies belong to other Epics: `PersistenceModule`, `StorageModule`, `DomainModule`, `S3Module`, `AdminModule`. This keeps `AppModule` compilable in isolation. `CommonModule`, `SpaModule`, and the `HealthModule` are owned by Stories within this Epic and are not placeholdered here.

## Files to create / modify
- `apps/openbucket-backend/src/persistence/persistence.module.ts` — new (placeholder)
- `apps/openbucket-backend/src/storage/storage.module.ts` — new (placeholder)
- `apps/openbucket-backend/src/domain/domain.module.ts` — new (placeholder)
- `apps/openbucket-backend/src/s3/s3.module.ts` — new (placeholder)
- `apps/openbucket-backend/src/admin/admin.module.ts` — new (placeholder)

## Implementation notes
- Each file:
  ```ts
  import { Module } from '@nestjs/common';
  @Module({})
  export class XxxModule {}
  ```
- §1.1 describes each module's responsibility — these placeholders intentionally contain none of it. Subsequent Epics overwrite them.
- Quote from §1.1 (line 116): "`PersistenceModule` — registers MikroORM with the entity classes from `libs/persistence`. … Implementation details belong to the persistence agent [see §2]."

## Acceptance criteria
- [ ] Each module file exists, exports an empty class with `@Module({})`.
- [ ] `nx build openbucket-backend` compiles cleanly.

## Test obligations
- Unit: covered by [TEST-0001]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.1 (lines 112–122)
