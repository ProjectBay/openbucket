---
id: STORY-0201
title: Define core object entities (Bucket, ObjectEntity, ObjectVersion)
epic: EPIC-03
status: done
size: M
risk: low
---

## User story
As a developer, I want the three S3-domain MikroORM entities (`Bucket`, `ObjectEntity`, `ObjectVersion`) and their shared types/enums declared in `libs/persistence/`, so that S3 controller code, repositories, and the writer service can persist bucket configuration, current pointers, and per-version metadata against a stable schema.

## Description
Implement the shared types/enum module (`VersioningState`, `ObjectLockMode`, `StorageClass`, JSON-typed config interfaces, `TagSet`) and the three core entities exactly as specified in §3.2.1–§3.2.4. Each entity declares MikroORM decorators with explicit column types/lengths, JSON columns where the spec marks them, surrogate string PK on `ObjectEntity` plus a unique `(bucket, key)` constraint, and the composite primary key on `ObjectVersion`. Entities live under `libs/persistence/src/entities/` and will be re-exported from the barrel in [STORY-0204].

## Acceptance criteria
- [x] `libs/persistence/src/entities/types.ts` exports `VersioningState`, `ObjectLockMode`, `StorageClass`, `ObjectLockBucketConfig`, `ObjectLockObjectState`, `EncryptionConfig`, `CorsRule`, `LifecycleRule`, `PolicyDocument`, `TagSet` exactly as §3.2.1.
- [x] `Bucket` declares `name` as a length-63 string PK with `Collection<ObjectEntity>` on `objects`, JSON columns for `objectLock`, `encryption`, `cors`, `lifecycle`, `tagging`, `policy`.
- [x] `ObjectEntity` declares string PK `id` (uuid v7), `@Unique` on `(bucket, key)` named `uq_objects_bucket_key`, indexes `ix_objects_bucket_key` and `ix_objects_bucket_softdeleted`, FK to `Bucket` via `fieldName: 'bucket_name'` with `deleteRule: 'cascade'`.
- [x] `ObjectVersion` declares composite PK `(bucket, key, versionId)`, JSON `userMetadata`, indexes `ix_versions_bucket_key_version` and `ix_versions_bucket_key_created`.
- [x] Unit tests inserting and reading back each entity against a real in-memory SQLite pass (TEST-0201).

## Tasks
- [TASK-0603] Author shared types and enums module
- [TASK-0604] Implement `Bucket` entity
- [TASK-0605] Implement `ObjectEntity` entity
- [TASK-0606] Implement `ObjectVersion` entity

## Test plan
- [TEST-0201] Core entity persistence round-trip

## Dependencies
- Blocks: [STORY-0202], [STORY-0203], [STORY-0204], [STORY-0205], [STORY-0206], [STORY-0209], [STORY-0213]
- Blocked by: [STORY-0200]

## References
- `docs/WHITEPAPER.md` §3.2.1 (lines 3053–3128), §3.2.2 (lines 3130–3185), §3.2.3 (lines 3187–3248), §3.2.4 (lines 3250–3291)
- Interfaces produced: `Bucket`, `ObjectEntity`, `ObjectVersion`, `VersioningState`, `StorageClass`, `TagSet`
