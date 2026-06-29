---
id: TEST-0104
title: SigV4 canonical-request and verifier unit
covers: [STORY-0103, TASK-0311, TASK-0312, TASK-0313, TASK-0314, TASK-0315]
status: done
level: unit
---

## Goal
Verify `buildCanonicalRequest`, `awsUriEncode`, `Sigv4Verifier.signatureForHeaderRequest`, `constantTimeEquals`, and `SigV4Guard.canActivate` against AWS reference vectors and the `aws4` library.

## Setup
- Jest. Use `aws4` as the cross-check: sign a fake request with `aws4.sign({...}, { accessKeyId, secretAccessKey })`, then re-verify with our verifier.

## Cases
1. `awsUriEncode('a b/c?d', false)` → `'a%20b/c%3Fd'`.
2. `awsUriEncode('a b/c', true)` → `'a%20b%2Fc'`.
3. `awsUriEncode('é', true)` → UTF-8 percent-encoded.
4. `canonicaliseQuery('b=2&a=1&a=3')` returns `'a=1&a=3&b=2'` (sorted by key then value).
5. `buildCanonicalRequest` for a known fixture matches the AWS docs reference value.
6. `Sigv4Verifier.signatureForHeaderRequest` produces the same hex as `aws4.sign` for a matched input.
7. `constantTimeEquals('abc','abc')` → true; `('abc','abd')` → false; `('ab','abc')` → false.
8. `SigV4Guard.canActivate` with `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` → throws `InvalidArgumentError` with `extra.ArgumentName='x-amz-content-sha256'`.
9. `SigV4Guard.checkSkew` with `t = now ± 14 min` → ok; with `t = now ± 16 min` → `RequestTimeTooSkewedError`.
10. `parseAuthorization('AWS4-HMAC-SHA256 Credential=AKID/20260520/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=deadbeef')` → returns the parsed parts.

## Tooling
- Framework: jest, aws4 (cross-check library)
- Runner: `nx test backend --testPathPattern=sigv4`

## Pass criteria
- [ ] All ten cases pass.

## References
- `docs/WHITEPAPER.md` §2.4 (lines 1576–1982)
