---
id: TASK-0319
title: Implement 404-class errors
story: STORY-0105
status: done
type: implementation
size: XS
---

## Description
Implement the 404 NoSuch* family per §2.6.

## Files to create / modify
- `apps/backend/src/s3/errors/s3-error.ts` — modify

## Implementation notes
- Verbatim from §2.6 (lines 2242–2283):
  - `NoSuchBucketError` — code `NoSuchBucket`, message `The specified bucket does not exist`, `extra.BucketName`.
  - `NoSuchKeyError` — code `NoSuchKey`, message `The specified key does not exist.`, `extra.Key`.
  - `NoSuchUploadError` — code `NoSuchUpload`, message `The specified multipart upload does not exist.`.
  - `NoSuchVersionError` — code `NoSuchVersion`.
  - `NoSuchCORSConfigurationError` — code `NoSuchCORSConfiguration`.
  - `NoSuchLifecycleConfigurationError` — code `NoSuchLifecycleConfiguration`.
  - `NoSuchBucketPolicyError` — code `NoSuchBucketPolicy`.
  - `NoSuchTagSetError` — code `NoSuchTagSet`.
- All have `httpStatus = 404`.

## Acceptance criteria
- [ ] Every code matches §2.6 verbatim.
- [ ] `extra.BucketName` / `extra.Key` set where the constructor takes the name.

## Test obligations
- Unit: covered by [TEST-0109]
- E2E: covered by [TEST-0110], [TEST-0115]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0317]

## References
- `docs/WHITEPAPER.md` §2.6 (lines 2242–2283)
