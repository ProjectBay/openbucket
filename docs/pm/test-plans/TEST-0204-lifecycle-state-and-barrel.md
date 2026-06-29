---
id: TEST-0204
title: LifecycleState persistence and barrel imports
covers: [STORY-0204, TASK-0612, TASK-0613]
status: done
level: unit
---

## Goal
Verify the `LifecycleState` entity persists with its composite PK and FK cascade, and that every symbol expected from `@openbucket/persistence` is exported by the barrel.

## Setup
- Real `:memory:` SQLite; initial migration applied at suite setup.

## Cases
1. Given a `Bucket { name: 'b' }` and a `LifecycleState { bucket, ruleId: 'r1' }`, when persisted then read back, `lastSweepAt` is `undefined` (NULL) and `lastKeyProcessed` is `undefined` (NULL).
2. Given the row from case 1, when `lastKeyProcessed` is updated to `'photos/2026/may.jpg'` and flushed, the read-back returns the same string.
3. Given two `LifecycleState` rows for the same bucket with different `ruleId`, both persist.
4. Given the bucket from case 1 is deleted, both `LifecycleState` rows cascade-delete.
5. Given a TypeScript test fixture importing `{ Bucket, ObjectEntity, ObjectVersion, MultipartUpload, MultipartPart, AccessKey, AdminUser, RefreshToken, LifecycleState, BucketRepository, ObjectRepository, VersioningState, StorageClass } from '@openbucket/persistence';`, the file type-checks and all symbols are non-null.

## Tooling
- Framework: jest
- Runner: `nx test persistence --testPathPattern=lifecycle-state.spec.ts` plus `nx build persistence`

## Pass criteria
- [x] All five cases pass (`libs/persistence/src/lifecycle-state.spec.ts`).
- [x] `nx build persistence` succeeds with no missing-export errors (added a `@nx/js:tsc` build target).

## References
- `docs/WHITEPAPER.md` §3.2.9 (lines 3449–3472), §3.2.10 (lines 3474–3491)
