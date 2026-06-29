---
id: TEST-0202
title: Multipart entity cascade and lookup
covers: [STORY-0202, TASK-0607, TASK-0608]
status: done
level: unit
---

## Goal
Verify `MultipartUpload` and `MultipartPart` persist correctly, the composite PK on parts is enforced, and `orphanRemoval` + FK cascade delete parts when the upload is removed.

## Setup
- Real `:memory:` SQLite; initial migration applied at suite setup.

## Cases
1. Given a `Bucket` and a fresh `MultipartUpload { uploadId: 'u1', key: 'k', bucket }`, when persisted, then the row exists and `initiator === 'root'` (default).
2. Given the upload from case 1, when three `MultipartPart`s with `partNumber: 1, 2, 3` are persisted, then `em.findOne(MultipartUpload, { uploadId: 'u1' }, { populate: ['parts'] })` returns the upload with `parts.length === 3` ordered by part number.
3. Given two `MultipartPart`s with the same `(upload, partNumber)`, when the second is flushed, then the composite PK constraint rejects it.
4. Given the upload from case 2, when `em.remove(upload)` is flushed, then both `multipart_uploads` and `multipart_parts` rows are gone (verify via raw `select count(*)` queries).
5. Given a `MultipartPart { checksumSha256: undefined }`, the column persists as `NULL`.

## Tooling
- Framework: jest
- Runner: `nx test persistence --testPathPattern=multipart-entities.spec.ts`

## Pass criteria
- [x] All five cases pass (`libs/persistence/src/multipart-entities.spec.ts`).

## Realization note
Schema built via `orm.schema.createSchema()` (initial migration is STORY-0205).
Case 2 asserts the populated part numbers as a sorted set rather than relying on
collection iteration order.

## References
- `docs/WHITEPAPER.md` §3.2.5 (lines 3293–3364)
