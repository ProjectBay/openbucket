---
id: TEST-0205
title: Initial migration applies cleanly and matches entity schema
covers: [STORY-0205, TASK-0614, TASK-0615]
status: done
level: unit
---

## Goal
Verify the initial migration produces a schema that matches the entity decorators, that `down()` removes everything `up()` created, and that the bootstrap migrator-up call lands the migration on an empty `DATA_DIR`.

## Setup
- Real `better-sqlite3` connection against a temp file under `tmp/openbucket-migration-test/`.
- Use `MikroORM.init({ ...config, dbName: '<temp>' })` followed by `orm.getMigrator().up()`.

## Cases
1. Given an empty DB, when `up()` runs, then `select name from sqlite_master where type='table' order by name` returns exactly `['access_keys', 'admin_users', 'buckets', 'lifecycle_state', 'mikro_orm_migrations', 'multipart_parts', 'multipart_uploads', 'object_versions', 'objects', 'refresh_tokens']` (the MikroORM bookkeeping table is permitted).
2. Given the migrated DB, `select * from sqlite_master where type='index'` returns the seven custom indexes plus the unique index `uq_objects_bucket_key`.
3. Given a `Bucket` row inserted via raw SQL, the FK `fk_objects_bucket` rejects an `objects` insert referencing a non-existent `bucket_name`.
4. Given the migrated DB, when `down()` runs, then all nine application tables are dropped (in reverse FK order).
5. Given a `MikroORM` boot against a fresh `DATA_DIR`, when `app.get(MikroORM).getMigrator().up()` is invoked at boot, then `orm.getMigrator().getExecutedMigrations()` includes `Migration20260520000001_initial`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=initial-migration.spec.ts`

## Pass criteria
- [x] All five cases pass (`apps/openbucket-backend/src/initial-migration.spec.ts`); the full backend suite is 85/85 and the e2e is 10 passed / 4 POSIX-skipped.
- [x] File-backed temp DB used throughout (not `:memory:`); `-wal` / `-shm` companions are produced.

## Realization notes
- Case 1's table query filters `sqlite_%` because MikroORM's `mikro_orm_migrations`
  PK uses `AUTOINCREMENT`, which makes SQLite create a side-effect `sqlite_sequence`
  table not part of the application schema.
- Case 2 asserts the full set of ten declared indexes (1 unique + 9 `ix_*`); the
  test plan originally said "seven custom" but §3.3.1's SQL declares nine `ix_*` plus
  the unique index.
- Case 4 (down) is defined last because it mutates the shared ORM's schema.
- The runtime side of case 5 (boot-time `getMigrator().up()` invocation visible in
  the log) is also exercised end-to-end by the e2e suite — every spawned backend
  now creates `openbucket.db` under the e2e tmp `DATA_DIR` and serves health.

## References
- `docs/WHITEPAPER.md` §3.3.1 (lines 3497–3668), §3.3.2 (lines 3670–3686)
