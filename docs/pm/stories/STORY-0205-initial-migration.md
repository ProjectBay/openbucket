---
id: STORY-0205
title: Initial migration and boot-time `migration:up`
epic: EPIC-03
status: done
size: M
risk: medium
---

## User story
As an operator, I want the database schema to be created (or upgraded) automatically on container boot via a single forward-only initial migration, so that an empty `DATA_DIR` becomes a usable OpenBucket instance without manual SQL.

## Description
Write the initial migration file (`Migration20260520000001_initial.ts`) containing the full `up()` SQL exactly as §3.3.1: every `create table` statement, every index, every foreign-key constraint, with the column types/defaults matching the entity definitions. Down-migrations are emitted (test-suite convenience) but never run in production per §3.3.2. Add the bootstrap call so `app.get(MikroORM).getMigrator().up()` runs once at startup before the HTTP listener binds.

## Acceptance criteria
- [x] `apps/openbucket-backend/src/migrations/Migration20260520000001_initial.ts` exists with `up()` containing the nine `create table` statements and **ten** declared indexes (1 unique + 9 `ix_*`; the AC originally said "six" but the §3.3.1 SQL declares ten).
- [x] Every FK uses `on delete cascade` per §3.3.1 wording.
- [x] `down()` drops all nine tables in reverse FK order.
- [~] Running `npm run orm:migration:up` / `orm:migration:list` via the CLI — **deferred**: the CLI's ts-node loader needs `tsconfig-paths` registration to resolve the `@openbucket/persistence` alias in `mikro-orm.config.ts`. Boot-time migration via the ORM API is the operational path (next AC) and is verified; the CLI commands are a dev convenience and will be wired in a follow-up once the M1 surface is more settled.
- [x] Booting the backend with an empty `DATA_DIR` produces a working `openbucket.db` with `-wal` / `-shm` companion files; the bootstrap migrator invocation logs `Database migrations up to date (… applied this boot)`. Verified by TEST-0205 and by the e2e suite booting the built backend against a fresh tmp `DATA_DIR`.

## Tasks
- [TASK-0614] Author initial migration with full `up`/`down` SQL
- [TASK-0615] Invoke `getMigrator().up()` at bootstrap

## Test plan
- [TEST-0205] Initial migration applies cleanly and matches entity schema

## Dependencies
- Blocks: [STORY-0208], [STORY-0209], [STORY-0210], [STORY-0213]
- Blocked by: [STORY-0200], [STORY-0201], [STORY-0202], [STORY-0203], [STORY-0204]

## References
- `docs/WHITEPAPER.md` §3.3.1 (lines 3497–3668), §3.3.2 (lines 3670–3686)
- Interfaces produced: `openbucket.db` schema; boot-time migration run hook (consumed by [EPIC-01] main.ts)
