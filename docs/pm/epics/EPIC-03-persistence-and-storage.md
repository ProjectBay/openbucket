---
id: EPIC-03
title: Persistence & storage layer
status: backlog
whitepaper_section: "§3"
owner_area: persistence
---

## Objective

Deliver everything that touches durable state: the MikroORM
bootstrap with WAL-mode PRAGMAs, all nine entities and their initial
migration, repositories with the queries other Epics depend on,
deterministic key encoding at the filesystem boundary, the
path-mirror `BlobStore` with atomic-rename semantics, the two-phase
commit pattern that keeps SQLite and the filesystem consistent across
crashes, the startup orphan-blob scan, trash management primitives,
the `KeyService.getSecret` interface consumed by the S3 SigV4 guard,
and the per-version storage layout (delete markers and non-current
versions).

## Scope

- In scope:
  - `mikro-orm.config.ts` with `BetterSqliteDriver`, `afterCreate` PRAGMA hook (WAL, foreign keys, busy timeout, mmap), request-scoped EM.
  - Entity definitions: `Bucket`, `ObjectEntity`, `ObjectVersion`, `MultipartUpload`, `MultipartPart`, `AccessKey`, `AdminUser`, `RefreshToken`, `LifecycleState`.
  - Initial migration (one file, full SQL).
  - Repositories: `BucketRepository`, `ObjectRepository` with `findCurrentVersion(bucket, key)` and `listByPrefix(bucket, prefix, marker, limit)`.
  - `encodeKey`/`decodeKey` plus `KeyTooLongError`.
  - `BlobStore`: `putBlob`, `getBlob`, `headBlob`, `deleteBlob`, `composeBlobs`, with cross-device-link (`EXDEV`) fallback.
  - Two-phase commit `ObjectWriterService`.
  - Startup crash-recovery scan: orphans in `blobs/` and `multipart/`.
  - Trash manifest schema and move-to-trash flow (purge tick lives in EPIC-04).
  - `KeyService.getSecret(accessKeyId)` with in-memory cache + DB miss path; cache invalidation on key updates.
  - Versioning storage: `promoteToCurrent`, `writeDeleteMarker`, `listVersions`, and the on-disk `<key>.v/<versionId>` layout.
- Out of scope:
  - Nest module wiring, classifier middleware, bootstrap, ConfigModule — owned by EPIC-01.
  - S3 wire protocol XML, route handlers, SigV4 internals — owned by EPIC-02.
  - Streaming the request body to/from disk, range request math, background tick implementation — owned by EPIC-04.
  - Frontend, JWT, Docker, CI — owned by EPIC-05 / EPIC-06.

## Success criteria

- `mikro-orm migration:up` from an empty volume yields a schema matching the entity definitions, with WAL files present.
- A unit test inserts and reads back every entity type.
- `putBlob` of a multi-MB stream lands at the correct path and is atomic across crash injection between rename and row insert (verified by the orphan scan).
- `encodeKey`/`decodeKey` round-trip for ASCII, UTF-8, with `/`, with leading `.`, with trailing space.
- `KeyService.getSecret` returns `null` for both unknown and disabled keys (no leak), and the cache is invalidated on update.
- The startup orphan scan logs orphans without auto-deleting (v1 policy).

## Stories

- [STORY-0200] MikroORM bootstrap with WAL PRAGMAs and request-scoped EM
- [STORY-0201] Define core object entities (Bucket, ObjectEntity, ObjectVersion)
- [STORY-0202] Define multipart entities (MultipartUpload, MultipartPart)
- [STORY-0203] Define auth and admin entities (AccessKey, AdminUser, RefreshToken)
- [STORY-0204] Define LifecycleState entity and persistence barrel
- [STORY-0205] Initial migration and boot-time `migration:up`
- [STORY-0206] Repository pattern (BucketRepository, ObjectRepository)
- [STORY-0207] Filesystem-safe key encoding (`encodeKey`/`decodeKey`)
- [STORY-0208] BlobStore — atomic stage-and-rename filesystem layer
- [STORY-0209] Two-phase commit `ObjectWriterService`
- [STORY-0210] Startup crash recovery and orphan-blob scan
- [STORY-0211] Trash manifest schema and write-after-move ordering
- [STORY-0212] `KeyService.getSecret` interface for SigV4 lookup
- [STORY-0213] Versioning storage (`VersionStoreService`, demote-on-write)

## Dependencies

- Blocks: [EPIC-02], [EPIC-04], [EPIC-05], [EPIC-06]
- Blocked by: [EPIC-01]

## References

- `docs/WHITEPAPER.md` §3 (lines 2815–5192)
  - §3.1 MikroORM bootstrap (lines 2828–3048)
  - §3.2 Entity definitions (lines 3049–3494)
  - §3.3 Migrations (lines 3495–3689)
  - §3.4 Repository pattern (lines 3690–3876)
  - §3.5 Key encoding (lines 3877–4127)
  - §3.6 BlobStore (lines 4128–4484)
  - §3.7 Two-phase commit pattern (lines 4485–4647)
  - §3.8 Crash recovery & orphan scan (lines 4648–4803)
  - §3.9 Trash management (lines 4804–4828)
  - §3.10 `KeyService.getSecret` interface (lines 4829–4956)
  - §3.11 Versioning storage (lines 4957–5192)
- `docs/ARCHITECTURE.md` §5, §6, §7, §8
- `docs/BACKEND-DESIGN.md` §2
