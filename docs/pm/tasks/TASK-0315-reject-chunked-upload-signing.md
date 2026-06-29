---
id: TASK-0315
title: Reject STREAMING-AWS4-HMAC-SHA256-PAYLOAD chunked uploads
story: STORY-0103
status: done
type: implementation
size: XS
---

## Description
Per the v1 decision in §2.4.6, the `SigV4Guard` rejects chunked-payload signing at the earliest possible point: before reading any of the body. The rejection is `InvalidArgumentError` referencing `x-amz-content-sha256` and the rejected value, yielding a 400 response with the canonical AWS XML envelope.

## Files to create / modify
- `apps/backend/src/s3/sigv4/sigv4.guard.ts` — modify (in `canActivate`)

## Implementation notes
- Verbatim from §2.4.3 (lines 1655–1664) and §2.4.6 (lines 1946–1981):
  ```ts
  const STREAMING_SHA = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
  // ...
  const contentSha = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
  if (contentSha === STREAMING_SHA) {
    throw new InvalidArgumentError(
      'STREAMING-AWS4-HMAC-SHA256-PAYLOAD is not supported. ' +
        'Set x-amz-content-sha256: UNSIGNED-PAYLOAD instead.',
      'x-amz-content-sha256',
      STREAMING_SHA,
    );
  }
  ```
- Rendered as the XML body shown in §2.4.6 (lines 1964–1973). Trailing-checksum (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`) is **accepted** — only the explicit chunked-HMAC variant is rejected (§2.4.1 lines 1582–1588).
- Document the `aws s3 cp --no-payload-signing` and `s3.payload_signing_enabled = false` workarounds in the README compatibility notes (§2.4.6 lines 1975–1981) — out of scope for this Task but cross-referenced.

## Acceptance criteria
- [ ] `PUT` with `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` returns 400 with `<Code>InvalidArgument</Code>`, `<ArgumentName>x-amz-content-sha256</ArgumentName>`, `<ArgumentValue>STREAMING-AWS4-HMAC-SHA256-PAYLOAD</ArgumentValue>`.
- [ ] `STREAMING-UNSIGNED-PAYLOAD-TRAILER` is not rejected by this check.

## Test obligations
- Unit: covered by [TEST-0104]
- E2E: covered by [TEST-0106]
- Conformance: covered by [TEST-0106]

## Dependencies
- Blocked by: [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.4.6 (lines 1946–1981), §2.4.3 (lines 1655–1664)
