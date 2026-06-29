---
id: TEST-0109
title: S3 error taxonomy unit
covers: [STORY-0105, TASK-0317, TASK-0318, TASK-0319, TASK-0320]
status: done
level: unit
---

## Goal
Verify every concrete `S3Error` class in §2.6 has the right `code`, `httpStatus`, default message, and `extra` fields.

## Setup
- Jest.

## Cases
1. For each class in §2.6, instantiate with the documented constructor args and assert:
   - `instanceof S3Error === true`
   - `error.code` equals the documented string verbatim.
   - `error.httpStatus` equals the documented status.
   - `error.message` equals the default message (or formatted with the provided arg) verbatim.
   - `error.extra` contains the documented keys.
2. `InvalidArgumentError('msg', 'argName', 'val')` → `extra.ArgumentName === 'argName'`, `extra.ArgumentValue === 'val'`.
3. `EntityTooLargeError(100, 50)` → `extra.ProposedSize === 100`, `extra.MaxSizeAllowed === 50`.
4. `RequestTimeTooSkewedError(t)` → `extra.ServerTime` and `extra.RequestTime` are ISO 8601.
5. `NotImplementedError('SelectObjectContent')` → `extra.Operation === 'SelectObjectContent'`, `message === 'The SelectObjectContent operation is not implemented by OpenBucket.'`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=s3-error.spec.ts`

## Pass criteria
- [ ] All cases pass with verbatim strings from §2.6.

## References
- `docs/WHITEPAPER.md` §2.6 (lines 2133–2356)
