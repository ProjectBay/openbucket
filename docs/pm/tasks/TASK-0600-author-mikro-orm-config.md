---
id: TASK-0600
title: Author `mikro-orm.config.ts` with PRAGMA `afterCreate` hook
story: STORY-0200
status: done
type: implementation
size: S
---

## Description
Create the single MikroORM config used by both the runtime module and the CLI. Resolves `DATA_DIR` from `process.env.DATA_DIR ?? '/data'` (the runtime module re-resolves through `ConfigService`). Declares all nine entities explicitly, uses `TsMorphMetadataProvider`, enables `Migrator`, sets `allowGlobalContext: false`, and installs the PRAGMA hook in `pool.afterCreate`.

## Files to create / modify
- `apps/openbucket-backend/src/mikro-orm.config.ts` — new

## Implementation notes
- Default export is `defineConfig({...})` from `@mikro-orm/better-sqlite`.
- `dbName: join(DATA_DIR, 'openbucket.db')`.
- Entities array (verbatim, in this order): `Bucket, ObjectEntity, ObjectVersion, MultipartUpload, MultipartPart, AccessKey, AdminUser, RefreshToken, LifecycleState`.
- `metadataProvider: TsMorphMetadataProvider`.
- `extensions: [Migrator]`.
- `migrations`: `path: join(__dirname, 'migrations')`, `pathTs: join(__dirname, 'migrations')`, `glob: '!(*.d).{js,ts}'`, `transactional: true`, `disableForeignKeys: false`, `allOrNothing: true`, `emit: 'ts'`, `snapshot: true`.
- PRAGMA hook (exact statements, in this order):
  - `conn.pragma('journal_mode = WAL');`
  - `conn.pragma('synchronous = NORMAL');`
  - `conn.pragma('foreign_keys = ON');`
  - `conn.pragma('busy_timeout = 5000');`
  - `conn.pragma('temp_store = MEMORY');`
  - `conn.pragma('mmap_size = 268435456'); // 256 MiB`
  - `conn.pragma('cache_size = -65536');   // 64 MiB page cache`
- `allowGlobalContext: false`, `forceUtcTimezone: true`, `debug: process.env.NODE_ENV !== 'production'`.

## Acceptance criteria
- [ ] File compiles under `nx build openbucket-backend`.
- [ ] `npx mikro-orm --config=apps/openbucket-backend/src/mikro-orm.config.ts debug` resolves the config and reports the entity list.
- [ ] Opening a `better-sqlite3` connection through the config against `:memory:` and reading `PRAGMA foreign_keys` returns `1`.

## Test obligations
- Unit: covered by [TEST-0200]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: _none_ (within EPIC-03; assumes [EPIC-01] ConfigModule for env access)

## References
- `docs/WHITEPAPER.md` §3.1.1 (lines 2830–2925)
