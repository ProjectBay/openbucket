---
id: TASK-0313
title: Implement Sigv4Verifier
story: STORY-0103
status: done
type: implementation
size: M
---

## Description
Implement `Sigv4Verifier` per §2.4.4. Reconstructs the canonical request, derives the signing key chain, and produces the hex signature the client should have sent. Also exposes `constantTimeEquals` for callers.

## Files to create / modify
- `apps/backend/src/s3/sigv4/sigv4.verifier.ts` — new

## Implementation notes
- Verbatim signatures from §2.4.4 (lines 1761–1851):
  ```ts
  async signatureForHeaderRequest(args: {
    req: Request;
    secretAccessKey: string;
    credentialScope: string;        // 20260520/us-east-1/s3/aws4_request
    signedHeaders: string[];
    amzDate: string;
  }): Promise<string>;

  constantTimeEquals(a: string, b: string): boolean;
  ```
- Payload hash: `(req.headers['x-amz-content-sha256'] as string | undefined) ?? 'UNSIGNED-PAYLOAD'`.
- String to sign: `['AWS4-HMAC-SHA256', amzDate, credentialScope, hashedCanonical].join('\n')`.
- Key chain: `kDate = hmac('AWS4'+secret, date)`, `kRegion = hmac(kDate, region)`, `kService = hmac(kRegion, service)`, `kSigning = hmac(kService, 'aws4_request')`.
- `constantTimeEquals` uses `crypto.timingSafeEqual` after converting both to `Buffer.from(s, 'utf8')`; returns `false` immediately on length mismatch.
- Helpers `originalPath(req)` and `queryStringForCanonical(req)` parse `req.originalUrl` via `new URL(\`http://h${req.originalUrl}\`)` and return `u.pathname` / `u.search.slice(1)` respectively.

## Acceptance criteria
- [ ] Cross-check: aws4.sign produces a signature equal to `signatureForHeaderRequest` for the same inputs.
- [ ] `constantTimeEquals('abc', 'abd')` returns `false`; `('abc','abc')` returns `true`; mismatched-length always `false`.
- [ ] `nx test backend --testPathPattern=sigv4.verifier.spec.ts` passes.

## Test obligations
- Unit: covered by [TEST-0104]
- E2E: covered by [TEST-0105]
- Conformance: covered transitively by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0312]

## References
- `docs/WHITEPAPER.md` §2.4.4 (lines 1759–1851)
