---
id: TEST-0200
title: PRAGMA hook and config wiring unit verification
covers: [STORY-0200, TASK-0600, TASK-0601, TASK-0602]
status: done
level: unit
---

## Goal
Verify that the `mikro-orm.config.ts` and `PersistenceModule` produce an `EntityManager` whose connection has all the required PRAGMAs applied, and that the migration CLI scripts resolve.

## Setup
- Spin up a real `better-sqlite3` connection against a temporary file-backed DB (not `:memory:`, since `journal_mode = WAL` is meaningful only on file-backed DBs) under `tmp/openbucket-pragma-test/`.
- Bootstrap a minimal Nest test module importing `PersistenceModule` with `DATA_DIR` pointing at the temp dir.

## Cases
1. Given a fresh `DATA_DIR`, when the module initializes, then `PRAGMA journal_mode` returns `'wal'`.
2. Given the same connection, `PRAGMA foreign_keys` returns `1`, `PRAGMA busy_timeout` returns `5000`, `PRAGMA temp_store` returns `2` (MEMORY), `PRAGMA mmap_size` returns a value `>= 268435456`, `PRAGMA cache_size` returns `-65536`, `PRAGMA synchronous` returns `1` (NORMAL).
3. Given the test module, when `EntityManager` is injected and `em.fork().getConnection().execute('select 1 as x')` runs, then it returns `[{ x: 1 }]`.
4. Given the package scripts in `apps/openbucket-backend/package.json`, when `npm run -w apps/openbucket-backend orm -- --help` runs, then it exits 0 and prints the `mikro-orm` CLI help.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=persistence.module.spec.ts`

## Pass criteria
- [x] All four cases pass (`persistence.module.spec.ts`, 80/80 backend tests green on node 20).
- [x] `-wal` and `-shm` companion files exist next to `openbucket.db` after the test runs.

## Realization note
The PRAGMA value lookup reads the first column of the `PRAGMA <name>` result row
rather than keying by the pragma name — SQLite returns `PRAGMA busy_timeout` in a
column called `timeout`. Case 4 (`npm run -w apps/openbucket-backend orm -- --help`)
required registering the backend as an npm workspace.

## References
- `docs/WHITEPAPER.md` §3.1 (lines 2828–3046)
- `docs/BACKEND-DESIGN.md` §2 (lines 75–86)
