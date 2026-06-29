---
id: STORY-0116
title: Bucket encryption operations
epic: EPIC-02
status: done
size: S
risk: low
---

## User story
As an S3 client, I want `GET/PUT/DELETE /:bucket?encryption` to round-trip a `<ServerSideEncryptionConfiguration>` XML body (SSE-S3 only in v1), so that `aws s3api put-bucket-encryption` configures default encryption.

## Description
Realize the encryption rows from §2.8.2 (lines 2529–2531). v1 supports `SSE-S3` only — KMS variants surface as `InvalidArgument` (per the §2.8 notes column).

## Acceptance criteria
- [ ] `PUT /:bucket?encryption` accepts `<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm>` and persists it.
- [ ] `GET /:bucket?encryption` returns the persisted document.
- [ ] `DELETE /:bucket?encryption` clears the configuration.
- [ ] KMS algorithms (`aws:kms`) yield `InvalidArgument` in v1.

## Tasks
- [TASK-0358] Implement PutBucketEncryption, GetBucketEncryption, DeleteBucketEncryption

## Test plan
- [TEST-0129] Encryption e2e
- [TEST-0130] Encryption conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0102], [STORY-0103], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2529–2531)
- Interfaces consumed: `BucketService` (EPIC-03), `XmlInterceptor`
