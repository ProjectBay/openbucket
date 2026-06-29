---
id: STORY-0202
title: Define multipart entities (MultipartUpload, MultipartPart)
epic: EPIC-03
status: done
size: S
risk: low
---

## User story
As a developer, I want the `MultipartUpload` and `MultipartPart` MikroORM entities declared with the right cascade behaviour and indexes, so that the streaming agent can record multipart sessions and per-part metadata against a schema that supports both fast lookup and orphan cleanup.

## Description
Implement the two multipart-session entities exactly as specified in §3.2.5. `MultipartUpload` carries the upload id PK, FK to `Bucket`, the initiator, encryption config, content type, user metadata, initiated timestamp, and a `OneToMany` collection of parts with `orphanRemoval: true`. `MultipartPart` carries a composite PK `(upload, partNumber)`, size, ETag, optional `checksumSha256`, and `writtenAt`. Indexes match §3.2.5 exactly. Entities live under `libs/persistence/src/entities/` and will be re-exported from the barrel in [STORY-0204].

## Acceptance criteria
- [x] `MultipartUpload` PK is `uploadId` (string, length 64), FK to `Bucket` via `fieldName: 'bucket_name'` with `deleteRule: 'cascade'`, with indexes `ix_mpu_bucket_key` and `ix_mpu_initiated`.
- [x] `MultipartUpload.parts` is a `Collection<MultipartPart>` with `orphanRemoval: true`.
- [x] `MultipartPart` PK is composite `(upload, partNumber)`, FK uses `fieldName: 'upload_id'` with `deleteRule: 'cascade'`, with index `ix_mpp_upload_part`.
- [x] Unit tests insert an upload with multiple parts, delete the upload, and observe parts cascade-removed (TEST-0202).

## Tasks
- [TASK-0607] Implement `MultipartUpload` entity
- [TASK-0608] Implement `MultipartPart` entity

## Test plan
- [TEST-0202] Multipart entity cascade and lookup

## Dependencies
- Blocks: [STORY-0204], [STORY-0205], [STORY-0210]
- Blocked by: [STORY-0201]

## References
- `docs/WHITEPAPER.md` §3.2.5 (lines 3293–3364)
- Interfaces produced: `MultipartUpload`, `MultipartPart`
