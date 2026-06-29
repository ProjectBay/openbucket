---
id: STORY-0105
title: S3Error class hierarchy and error taxonomy
epic: EPIC-02
status: done
size: S
risk: low
---

## User story
As a developer, I want a typed `S3Error` hierarchy covering the full taxonomy in §2.6, so that handlers can `throw new NoSuchKeyError(key)` and the exception filter will render canonical AWS XML.

## Description
Realize §2.6 of the white paper. Implement the abstract `S3Error` base with `code`, `httpStatus`, `resource?`, `requestId?`, and `extra: Record<string, string | number | undefined>`, then implement the full concrete hierarchy at 400/403/404/409/411/412/413/416/500/501/503.

## Acceptance criteria
- [ ] `S3Error` is an abstract `Error` subclass with all fields listed in §2.6 lines 2141–2154.
- [ ] All concrete error classes from §2.6 exist with the exact `code` strings, `httpStatus` codes, default messages, and `extra` fields documented (lines 2156–2356).
- [ ] `extra` is rendered as XML elements by the filter (verified via STORY-0106).
- [ ] No error class paraphrases an AWS code — strings match the white paper verbatim.

## Tasks
- [TASK-0317] Implement S3Error base and 400-class errors
- [TASK-0318] Implement 403-class errors
- [TASK-0319] Implement 404-class errors
- [TASK-0320] Implement 409/411/412/413/416/500/501/503 errors

## Test plan
- [TEST-0109] S3 error taxonomy unit

## Dependencies
- Blocks: [STORY-0101], [STORY-0102], [STORY-0103], [STORY-0104], [STORY-0106]
- Blocked by: (none — pure types)

## References
- `docs/WHITEPAPER.md` §2.6 (lines 2133–2356)
- Interfaces produced: `S3Error`, `InvalidBucketNameError`, `InvalidArgumentError`, `MalformedXMLError`, `InvalidPartError`, `InvalidPartOrderError`, `InvalidRequestError`, `EntityTooSmallError`, `IncompleteBodyError`, `MissingContentLengthError`, `RequestTimeTooSkewedError`, `AccessDeniedError`, `SignatureDoesNotMatchError`, `NoSuchBucketError`, `NoSuchKeyError`, `NoSuchUploadError`, `NoSuchVersionError`, `NoSuchCORSConfigurationError`, `NoSuchLifecycleConfigurationError`, `NoSuchBucketPolicyError`, `NoSuchTagSetError`, `BucketAlreadyExistsError`, `BucketAlreadyOwnedByYouError`, `BucketNotEmptyError`, `InvalidBucketStateError`, `OperationAbortedError`, `PreconditionFailedError`, `EntityTooLargeError`, `InvalidRangeError`, `NotImplementedError`, `ServiceUnavailableError`, `SlowDownError`, `InternalError`
