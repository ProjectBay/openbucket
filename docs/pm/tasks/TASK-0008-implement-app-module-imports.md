---
id: TASK-0008
title: Implement AppModule imports list
story: STORY-0004
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/app.module.ts` with the ordered imports listed in §1.3: `ConfigModule.forRoot`, `LoggerModule.forRootAsync`, `MikroOrmModule.forRootAsync`, then `CommonModule`, `PersistenceModule`, `StorageModule`, `DomainModule`, `S3Module`, `AdminModule`, `SpaModule`. Order is load-bearing — see the seven-step rationale in §1.3.

## Files to create / modify
- `apps/openbucket-backend/src/app.module.ts` — new

## Implementation notes
- Quote §1.3 (lines 256–328):
  ```ts
  @Module({
    imports: [
      // 1. Config first — every other module reads it.
      ConfigModule.forRoot({ isGlobal: true, cache: true, validate: loadEnv }),
      // 2. Logger
      LoggerModule.forRootAsync({ inject: [AppConfigService], useFactory: ... }),
      // 3. Persistence — MikroORM
      MikroOrmModule.forRootAsync({ inject: [AppConfigService], useFactory: ... }),
      // 4. Cross-cutting
      CommonModule,
      // 5. Lower layers
      PersistenceModule, StorageModule, DomainModule,
      // 6. Controller trees
      S3Module, AdminModule,
      // 7. SPA last so its catch-all sits at the bottom of the route table.
      SpaModule,
    ],
  })
  ```
- `MikroOrmModule.forRootAsync`'s factory delegates to `require('./persistence/mikro-orm.config').buildMikroOrmConfig(config)` per §1.3 (line 309). The persistence file body is owned by EPIC-03; this Task only references the import.

## Acceptance criteria
- [ ] `AppModule` imports the nine modules listed above in the documented order.
- [ ] `ConfigModule.forRoot` options are `{ isGlobal: true, cache: true, validate: loadEnv }`.
- [ ] `nx build openbucket-backend` compiles.

## Test obligations
- Unit: covered by [TEST-0004]
- E2E: N/A — wired exercises in STORY-0012/0013/0015 e2e
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001], [TASK-0002], [TASK-0019], [TASK-0028], [TASK-0030]

## References
- `docs/WHITEPAPER.md` §1.3 (lines 256–328)
