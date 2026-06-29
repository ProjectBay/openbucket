---
id: STORY-0204
title: Define LifecycleState entity and persistence barrel
epic: EPIC-03
status: done
size: S
risk: low
---

## User story
As a developer, I want the `LifecycleState` entity and a single `libs/persistence/src/index.ts` barrel that re-exports every entity, type, and repository, so that backend code can import everything via `@openbucket/persistence` and the MikroORM config can resolve the entity set from one place.

## Description
Implement `LifecycleState` exactly as §3.2.9: composite PK `(bucket, ruleId)`, FK to `Bucket` with `deleteRule: 'cascade'`, plus a nullable `lastSweepAt` timestamp and `lastKeyProcessed` resume cursor. Then create the barrel `libs/persistence/src/index.ts` that re-exports the shared types, all nine entity classes, and both repositories — the exact ordered export list from §3.2.10. Without the barrel, the `mikro-orm.config.ts` import in [STORY-0200] cannot resolve `@openbucket/persistence`.

## Acceptance criteria
- [x] `LifecycleState` declares composite PK `(bucket, ruleId)`, FK via `fieldName: 'bucket_name'` with `deleteRule: 'cascade'`, nullable `lastSweepAt`, nullable `lastKeyProcessed`.
- [x] `libs/persistence/src/index.ts` exports, in order: shared types, `Bucket`, `ObjectEntity`, `ObjectVersion`, `MultipartUpload`, `MultipartPart`, `AccessKey`, `AdminUser`, `RefreshToken`, `LifecycleState`, `BucketRepository`, `ObjectRepository` (matches §3.2.10; built incrementally across 0200-0204).
- [x] A consumer importing `import { Bucket, ObjectEntity } from '@openbucket/persistence';` type-checks (the backend's persistence.module/config already do, verified by TEST-0200; `nx build persistence` also passes).
- [x] Unit test inserts a `LifecycleState` row, updates `lastKeyProcessed`, reads it back (TEST-0204).

## Tasks
- [TASK-0612] Implement `LifecycleState` entity
- [TASK-0613] Author `libs/persistence/src/index.ts` barrel

## Test plan
- [TEST-0204] LifecycleState persistence and barrel imports

## Dependencies
- Blocks: [STORY-0200] (the config import resolves through this barrel), [STORY-0205]
- Blocked by: [STORY-0201], [STORY-0202], [STORY-0203], [STORY-0206]

## References
- `docs/WHITEPAPER.md` §3.2.9 (lines 3449–3472), §3.2.10 (lines 3474–3491)
- Interfaces produced: `LifecycleState`, `@openbucket/persistence` barrel
