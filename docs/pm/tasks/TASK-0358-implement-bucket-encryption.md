---
id: TASK-0358
title: Implement bucket encryption (GET/PUT/DELETE ?encryption)
story: STORY-0116
status: done
type: implementation
size: S
---

## Description
Implement the three bucket encryption operations per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2529–2531):
  - `| GET  | `/:bucket` | `encryption` | `GetBucketEncryption` |`
  - `| PUT  | `/:bucket` | `encryption` | `PutBucketEncryption` | SSE-S3 only in v1. |`
  - `| DELETE | `/:bucket` | `encryption` | `DeleteBucketEncryption` |`
- `PutBucketEncryption` is in `XML_REQUEST_OPS` (§2.3.2 line 1376).
- Body: `<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>`.
- Apply `@S3Operation('GetBucketEncryption' | 'PutBucketEncryption' | 'DeleteBucketEncryption')`.
- Reject `<SSEAlgorithm>aws:kms</SSEAlgorithm>` (and any non-`AES256`) with `InvalidArgumentError('SSE-KMS is not supported in v1', 'SSEAlgorithm', algorithm)`.

## Acceptance criteria
- [ ] PUT with `AES256` persisted via `BucketService.setEncryption(bucket, config)`.
- [ ] PUT with `aws:kms` → 400 `InvalidArgument`.
- [ ] GET returns the persisted document.
- [ ] DELETE clears and returns 204.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0129]
- Conformance: covered by [TEST-0130]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2529–2531), §2.3.2 (line 1376)
