---
id: TASK-0320
title: Implement 409/411/412/413/416/500/501/503 errors
story: STORY-0105
status: done
type: implementation
size: S
---

## Description
Implement the remaining error classes — 409 (Bucket state conflicts), 412 (precondition), 413 (entity too large), 416 (invalid range), 500 (internal), 501 (not implemented), 503 (service unavailable/slow down) — per §2.6.

## Files to create / modify
- `apps/backend/src/s3/errors/s3-error.ts` — modify

## Implementation notes
- Verbatim from §2.6 (lines 2285–2356):
  - **409**: `BucketAlreadyExistsError`, `BucketAlreadyOwnedByYouError`, `BucketNotEmptyError`, `InvalidBucketStateError`, `OperationAbortedError`.
  - **412**: `PreconditionFailedError`.
  - **413**: `EntityTooLargeError` — message `Your proposed upload exceeds the maximum allowed object size.`, extras `ProposedSize`, `MaxSizeAllowed`.
  - **416**: `InvalidRangeError`.
  - **500**: `InternalError` — default message `We encountered an internal error. Please try again.`.
  - **501**: `NotImplementedError(op)` — message `The ${op} operation is not implemented by OpenBucket.`, `extra.Operation = op`.
  - **503**: `ServiceUnavailableError`, `SlowDownError`.

## Acceptance criteria
- [ ] Every code/status pair matches §2.6 verbatim.
- [ ] `EntityTooLargeError(proposed, max)` populates the two extras.

## Test obligations
- Unit: covered by [TEST-0109]
- E2E: covered by [TEST-0110]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0317]

## References
- `docs/WHITEPAPER.md` §2.6 (lines 2285–2356)
