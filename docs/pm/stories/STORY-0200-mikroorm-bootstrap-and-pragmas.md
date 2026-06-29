---
id: STORY-0200
title: MikroORM bootstrap with WAL PRAGMAs and request-scoped EM
epic: EPIC-03
status: done
size: M
risk: medium
---

## User story
As a developer, I want a deterministic MikroORM configuration that opens the SQLite file under `DATA_DIR`, applies the WAL-mode and tuning PRAGMAs once per connection, and exposes a request-scoped `EntityManager`, so that every downstream Story can persist data through a single, consistent, well-tuned `EntityManager` without leaking identity maps across requests.

## Description
Produce the single source of truth for MikroORM configuration (`mikro-orm.config.ts`) used by both the runtime `MikroOrmModule.forRootAsync(...)` and the `mikro-orm` CLI for migrations. Add the `PersistenceModule` that wires `MikroOrmModule.forRootAsync` from `ConfigService`, declares all nine entities, and exports `BucketRepository`/`ObjectRepository`. Add the `orm:*` package scripts so migrations can be created and applied from CLI. The PRAGMA hook (WAL, foreign keys, busy timeout, mmap, cache, temp store) runs exactly once per connection in `pool.afterCreate`.

## Acceptance criteria
- [x] `apps/openbucket-backend/src/mikro-orm.config.ts` exports a `defineConfig` object (from `@mikro-orm/better-sqlite`) with the entities array exactly matching §3.1.1, `TsMorphMetadataProvider`, and `allowGlobalContext: false`. (`PersistenceModule` sets `driver: BetterSqliteDriver` explicitly; `defineConfig` from the better-sqlite package binds it in the CLI config.)
- [x] `pool.afterCreate` sets `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `temp_store = MEMORY`, `mmap_size = 268435456`, `cache_size = -65536`. (Verified by TEST-0200 against a real file-backed DB.)
- [x] `apps/openbucket-backend/src/persistence.module.ts` exposes a `@Global()` `PersistenceModule` that imports `MikroOrmModule.forRootAsync({...})` and `MikroOrmModule.forFeature({ entities: ENTITIES })`, providing `BucketRepository`, `ObjectRepository`.
- [~] Running the CLI (`npm run orm -- migration:list`) resolves the config without throwing. — **partial:** `orm -- --help` is verified (TEST-0200 case 4); full `migration:list` config resolution (ts-node + path aliases) lands with the initial migration in **STORY-0205**.
- [x] Opening a fork of the EM in a unit test against real (file-backed) SQLite confirms the PRAGMAs are applied (`PRAGMA journal_mode` returns `wal`; `PRAGMA foreign_keys` returns `1`).

## Tasks
- [TASK-0600] Author `mikro-orm.config.ts` with PRAGMA `afterCreate` hook
- [TASK-0601] Wire `PersistenceModule` with `MikroOrmModule.forRootAsync`
- [TASK-0602] Add `orm:*` package scripts for migration CLI

## Test plan
- [TEST-0200] PRAGMA hook and config wiring unit verification

## Implementation notes
- **EPIC-03 entry point — scaffolds for the 0200→0201/0206 import knot.** The
  config and `PersistenceModule` import all nine entities (and the two repos)
  from `@openbucket/persistence`, which are *owned* by STORY-0201–0204/0206 but
  *blocked by* this Story. To keep every commit compiling, 0200 creates
  `libs/persistence` with **PK-only entity stubs** and **injectable repository
  stubs**; the full column sets land in 0201–0204 and the real repository query
  surface in 0206. Each stub carries a `SCAFFOLD (STORY-0200)` marker.
- **Node runtime:** MikroORM 6.6.14 pins `better-sqlite3` 11.10.0, whose native
  binary must match the node ABI. This repo's target is node 20 (`@types/node`
  20.x); the persistence toolchain (install + `nx test`/`build`) runs on
  **node 20.18.0** (prebuilt binary, no compiler needed).
- **CLI scope:** `npm run -w apps/openbucket-backend orm -- --help` is verified
  (TEST-0200 case 4); the backend is registered as an npm workspace for it. Full
  `migration:list` config resolution (ts-node + path aliases) is exercised when
  the initial migration is generated in **STORY-0205**.

## Dependencies
- Blocks: [STORY-0201], [STORY-0205], [STORY-0206]
- Blocked by: _none_ (this Story is the EPIC-03 entry point; assumes ConfigModule from [EPIC-01])

## References
- `docs/WHITEPAPER.md` §3.1 (lines 2828–3046)
- `docs/BACKEND-DESIGN.md` §2 (lines 59–88)
- Interfaces produced: `PersistenceModule`, `mikro-orm.config.ts`, PRAGMA-tuned `EntityManager` consumed by every Story in EPIC-03 and beyond
