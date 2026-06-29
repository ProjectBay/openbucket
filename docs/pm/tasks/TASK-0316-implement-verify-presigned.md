---
id: TASK-0316
title: Implement verifyPresigned
story: STORY-0104
status: done
type: implementation
size: M
---

## Description
Implement the `verifyPresigned(req, keys, verifier)` function and the `parseAmzDate` / `stripParam` helpers per §2.5. Called by `SigV4Guard.checkPresigned` when `X-Amz-Signature` query param is present.

## Files to create / modify
- `apps/backend/src/s3/sigv4/presigned.ts` — new

## Implementation notes
- Verbatim from §2.5 (lines 2008–2121):
  ```ts
  const MAX_EXPIRES = 7 * 24 * 60 * 60;       // AWS: max 7 days.
  const MAX_SKEW_MS = 15 * 60 * 1000;

  export async function verifyPresigned(
    req: Request,
    keys: KeyService,
    verifier: Sigv4Verifier,
  ): Promise<boolean> { /* ... */ }
  ```
- Required query params: `X-Amz-Algorithm` (must equal `AWS4-HMAC-SHA256`), `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-SignedHeaders`, `X-Amz-Signature`.
- Validations:
  - `algorithm !== 'AWS4-HMAC-SHA256'` → `InvalidArgumentError('unsupported algorithm', 'X-Amz-Algorithm', algorithm ?? '')`.
  - Missing any → `AccessDeniedError('missing presigned URL parameter')`.
  - `!Number.isFinite(expires) || expires < 1 || expires > MAX_EXPIRES` → `InvalidArgumentError('X-Amz-Expires out of range', 'X-Amz-Expires', expiresStr)`.
  - `start - MAX_SKEW_MS > now` → `RequestTimeTooSkewedError(start)`.
  - `now > start + expires*1000` → `AccessDeniedError('Request has expired')`.
  - `service !== 's3' || terminator !== 'aws4_request'` → `AccessDeniedError('unexpected credential scope')`.
- `key = await keys.getSecret(accessKeyId)`; if null → return `false` (no leakage of whether the key id is known).
- Canonical query is built from `req.originalUrl` with `X-Amz-Signature` stripped (helper `stripParam`).
- `signedHeaders = signedHeadersStr.split(';').map(s => s.toLowerCase())`.
- `payloadHash: 'UNSIGNED-PAYLOAD'` for presigned (per §2.5 lines 2124–2129).
- Re-derive signing key chain inline (per §2.5 lines 2094–2098) and compare against `presentedSig` via `verifier.constantTimeEquals`.
- On success: `(req as any).openbucket.accessKeyId = accessKeyId; return true;`.

## Acceptance criteria
- [ ] Expired URL → `AccessDeniedError('Request has expired')`.
- [ ] Out-of-range expires → `InvalidArgumentError`.
- [ ] Unknown access key id → returns `false` (caller maps to `SignatureDoesNotMatchError`).
- [ ] Signature mismatch → returns `false`.

## Test obligations
- Unit: covered by [TEST-0107]
- E2E: covered by [TEST-0108]
- Conformance: covered by [TEST-0108]

## Dependencies
- Blocked by: [TASK-0312], [TASK-0313], [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.5 (lines 1985–2131)
