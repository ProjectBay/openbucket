---
id: TEST-0201
title: Core entity persistence round-trip (Bucket, ObjectEntity, ObjectVersion)
covers: [STORY-0201, TASK-0603, TASK-0604, TASK-0605, TASK-0606]
status: done
level: unit
---

## Goal
Verify each of the three core entities can be inserted, read back, and respects its constraints (PK uniqueness, FK cascade, JSON column round-trip).

## Setup
- Real `:memory:` SQLite created per test suite via `MikroORM.init({...config, dbName: ':memory:'})` (mock-free, per BACKEND-DESIGN §7.1).
- Run the initial migration once at suite setup.

## Cases
1. Given a fresh DB, when a `Bucket { name: 'b', versioning: VersioningState.Enabled, cors: [{ allowedOrigins: ['*'], allowedMethods: ['GET'] }] }` is persisted and re-read, then the JSON `cors` array is preserved byte-for-byte.
2. Given a `Bucket` with no explicit `region`/`versioning`, the read-back has `region = 'us-east-1'` and `versioning = 'disabled'`.
3. Given an inserted `ObjectEntity`, when a second insert with the same `(bucket, key)` is attempted, then the unique constraint `uq_objects_bucket_key` rejects it.
4. Given a versioned `Bucket` with two `ObjectVersion` rows for the same key, when the bucket is deleted, then both `ObjectVersion` rows cascade-delete (FK `fk_versions_bucket`).
5. Given an `ObjectEntity { size: 12345678901234n }`, the read-back has `size === 12345678901234n` (bigint preserved).
6. Given an `ObjectVersion { isDeleteMarker: true, size: 0n, etag: '' }`, the row persists without error.

## Tooling
- Framework: jest
- Runner: `nx test persistence --testPathPattern=entities.spec.ts`

## Pass criteria
- [x] All six cases pass (`libs/persistence/src/entities.spec.ts`).
- [x] No mocks are used for `EntityManager` — real `:memory:` SQLite.

## Realization note
Schema is built from entity metadata via `orm.schema.createSchema()` rather than
`migration:up` (the initial migration is STORY-0205). FilterQuery lookups use
object form (`{ name }`, `{ bucket: { name } }`) — MikroORM's typings reject a
bare PK string here. The on-disk metadata cache is disabled in the persistence
config because its JSON serializer throws on the `bigint` property defaults.

## References
- `docs/WHITEPAPER.md` §3.2.1 (lines 3053–3128), §3.2.2 (lines 3130–3185), §3.2.3 (lines 3187–3248), §3.2.4 (lines 3250–3291)
- `docs/BACKEND-DESIGN.md` §7.1 (lines 175–181)
