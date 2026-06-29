---
id: TASK-0314
title: Implement SigV4Guard header-based path
story: STORY-0103
status: done
type: implementation
size: M
---

## Description
Implement `SigV4Guard.canActivate` plus the header path (`checkHeader`), `parseAuthorization`, and `checkSkew`. The presigned branch (`checkPresigned` calling `verifyPresigned`) is delegated to TASK-0316.

## Files to create / modify
- `apps/backend/src/s3/sigv4/sigv4.guard.ts` — new

## Implementation notes
- Verbatim from §2.4.3 (lines 1624–1757):
  ```ts
  const MAX_SKEW_MS = 15 * 60 * 1000;        // AWS default ±15 minutes.
  const STREAMING_SHA = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';

  @Injectable()
  export class SigV4Guard implements CanActivate {
    constructor(
      private readonly keys: KeyService,
      private readonly verifier: Sigv4Verifier,
    ) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> { /* ... */ }
  }
  ```
- `canActivate`: if `contentSha === STREAMING_SHA` throw `InvalidArgumentError` per TASK-0315. If `query['X-Amz-Signature']` present, delegate to `checkPresigned`; else `checkHeader`.
- `checkHeader`: validate `authorization` starts with `'AWS4-HMAC-SHA256 '`; require `x-amz-date`; `checkSkew`; parse the Authorization header; call `keys.getSecret(accessKeyId)`; on null → `SignatureDoesNotMatchError()`; call verifier; mismatch → `SignatureDoesNotMatchError()`; success → set `req.openbucket.accessKeyId`.
- `parseAuthorization`: Format `AWS4-HMAC-SHA256 Credential=AKID/YYYYMMDD/region/s3/aws4_request, SignedHeaders=…, Signature=hex…`. Validates `service==='s3'` and `terminator==='aws4_request'`.
- `checkSkew`: parses ISO basic `YYYYMMDDTHHMMSSZ`; `Math.abs(Date.now() - t) > MAX_SKEW_MS` → `RequestTimeTooSkewedError(t)`.

## Acceptance criteria
- [ ] Missing `Authorization` → `AccessDeniedError('missing or unsupported Authorization header')`.
- [ ] Missing `X-Amz-Date` → `AccessDeniedError('missing X-Amz-Date')`.
- [ ] Mismatch → `SignatureDoesNotMatchError` with the canonical message.
- [ ] Skew > 15 min → `RequestTimeTooSkewedError`.
- [ ] `req.openbucket.accessKeyId` set on success.

## Test obligations
- Unit: covered by [TEST-0104]
- E2E: covered by [TEST-0105]
- Conformance: covered transitively by [TEST-0112], [TEST-0114]

## Dependencies
- Blocked by: [TASK-0311], [TASK-0313], [TASK-0315]

## References
- `docs/WHITEPAPER.md` §2.4.3 (lines 1622–1757)
