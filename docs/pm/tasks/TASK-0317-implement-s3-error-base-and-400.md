---
id: TASK-0317
title: Implement S3Error base and 400-class errors
story: STORY-0105
status: done
type: implementation
size: S
---

## Description
Implement the abstract `S3Error` base and the 400-class concrete error classes per §2.6.

## Files to create / modify
- `apps/backend/src/s3/errors/s3-error.ts` — new

## Implementation notes
- Verbatim base from §2.6 (lines 2141–2154):
  ```ts
  export abstract class S3Error extends Error {
    abstract readonly code: string;
    abstract readonly httpStatus: number;
    resource?: string;
    requestId?: string;

    /** Optional AWS-specific extra fields (rendered as elements). */
    extra: Record<string, string | number | undefined> = {};

    constructor(message: string) {
      super(message);
      this.name = this.constructor.name;
    }
  }
  ```
- Classes from §2.6 (lines 2157–2223) — `code`/`httpStatus`/default message verbatim:
  - `InvalidBucketNameError` — code `InvalidBucketName`, 400, message `The specified bucket is not valid: ${bucket}`, extra `BucketName`.
  - `InvalidArgumentError` — code `InvalidArgument`, 400, optional `extra.ArgumentName` and `extra.ArgumentValue`.
  - `MalformedXMLError` — code `MalformedXML`, 400, default message `The XML you provided was not well-formed`.
  - `InvalidPartError` — code `InvalidPart`, 400, message `One or more of the specified parts could not be found.`, optional `extra.PartNumber`.
  - `InvalidPartOrderError` — code `InvalidPartOrder`, 400, message `The list of parts was not in ascending order.`.
  - `InvalidRequestError` — code `InvalidRequest`, 400.
  - `EntityTooSmallError` — code `EntityTooSmall`, 400, message `Your proposed upload is smaller than the minimum allowed object size.`.
  - `IncompleteBodyError` — code `IncompleteBody`, 400.
  - `MissingContentLengthError` — code `MissingContentLength`, **411**.
  - `RequestTimeTooSkewedError` — code `RequestTimeTooSkewed`, 403, `extra.ServerTime`, `extra.RequestTime`.

## Acceptance criteria
- [ ] Every code string above matches §2.6 verbatim.
- [ ] `extra` is a plain object reset to `{}` per instance (not shared).
- [ ] Errors are throwable from any layer and `instanceof S3Error` returns `true`.

## Test obligations
- Unit: covered by [TEST-0109]
- E2E: covered by [TEST-0110]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300]

## References
- `docs/WHITEPAPER.md` §2.6 (lines 2139–2223)
