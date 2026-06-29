---
id: TASK-0601
title: Wire `PersistenceModule` with `MikroOrmModule.forRootAsync`
story: STORY-0200
status: done
type: implementation
size: S
---

## Description
Add the `@Global()` `PersistenceModule` so the rest of the app gets the `EntityManager` and the two custom repositories. It reads `DATA_DIR` from `ConfigService.getOrThrow<string>('DATA_DIR')` and re-uses the same entity list and PRAGMA hook as `mikro-orm.config.ts`.

## Files to create / modify
- `apps/openbucket-backend/src/persistence.module.ts` — new

## Implementation notes
- Use `MikroOrmModule.forRootAsync({ inject: [ConfigService], useFactory: (config) => ({ ... }) })`.
- Inside the factory: `driver: BetterSqliteDriver`, `dbName: join(config.getOrThrow<string>('DATA_DIR'), 'openbucket.db')`, `entities: ENTITIES`, `metadataProvider: TsMorphMetadataProvider`, `extensions: [Migrator]`, `allowGlobalContext: false`, `forceUtcTimezone: true`.
- `migrations`: `path: join(__dirname, 'migrations')`, `glob: '!(*.d).{js,ts}'`, `transactional: true`, `allOrNothing: true`, `snapshot: true`.
- `pool.afterCreate` PRAGMA block identical to TASK-0600 (WAL, synchronous NORMAL, foreign_keys ON, busy_timeout 5000, temp_store MEMORY, mmap_size 268435456, cache_size -65536).
- `debug: config.get('NODE_ENV') !== 'production'`.
- Additionally `MikroOrmModule.forFeature({ entities: ENTITIES })`.
- `providers: [BucketRepository, ObjectRepository]`.
- `exports: [MikroOrmModule, BucketRepository, ObjectRepository]`.
- The `MikroOrmMiddleware` from `@mikro-orm/nestjs` is wired in `main.ts` by [EPIC-01] — not this Task.

## Acceptance criteria
- [ ] `PersistenceModule` is decorated with `@Global()` and `@Module({...})`.
- [ ] Booting the Nest app with the module imported provides `EntityManager` injection in any service.
- [ ] `nx test backend --testPathPattern=persistence.module.spec.ts` passes a smoke test that injects `EntityManager` and runs `em.fork().getConnection().execute('select 1')`.

## Test obligations
- Unit: covered by [TEST-0200]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0600], [TASK-0613]

## References
- `docs/WHITEPAPER.md` §3.1.2 (lines 2927–3019)
