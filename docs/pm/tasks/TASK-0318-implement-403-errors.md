---
id: TASK-0318
title: Implement 403-class errors
story: STORY-0105
status: done
type: implementation
size: XS
---

## Description
Implement `AccessDeniedError` and `SignatureDoesNotMatchError` per §2.6.

## Files to create / modify
- `apps/backend/src/s3/errors/s3-error.ts` — modify

## Implementation notes
- Verbatim from §2.6 (lines 2225–2240):
  ```ts
  export class AccessDeniedError extends S3Error {
    readonly code = 'AccessDenied';
    readonly httpStatus = 403;
    constructor(message = 'Access Denied') { super(message); }
  }
  export class SignatureDoesNotMatchError extends S3Error {
    readonly code = 'SignatureDoesNotMatch';
    readonly httpStatus = 403;
    constructor() {
      super(
        'The request signature we calculated does not match the signature you provided. ' +
        'Check your key and signing method.',
      );
    }
  }
  ```

## Acceptance criteria
- [ ] Default `AccessDeniedError` message equals `'Access Denied'`.
- [ ] `SignatureDoesNotMatchError` message is verbatim from §2.6 (no paraphrasing).

## Test obligations
- Unit: covered by [TEST-0109]
- E2E: covered by [TEST-0105]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0317]

## References
- `docs/WHITEPAPER.md` §2.6 (lines 2225–2240)
