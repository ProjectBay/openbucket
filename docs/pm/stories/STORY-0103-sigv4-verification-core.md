---
id: STORY-0103
title: SigV4 verification core (header-based) and canonical request
epic: EPIC-02
status: done
size: M
risk: high
---

## User story
As an S3 client, I want my header-signed SigV4 requests to be reverse-verified against the root access key, so that authenticated operations succeed and tampered or unsigned requests are rejected.

## Description
Realize §2.4 of the white paper. Define the abstract `KeyService` boundary; implement `buildCanonicalRequest` with AWS-flavoured RFC 3986 encoding (single-pass, slash-preserving for paths); implement `Sigv4Verifier.signatureForHeaderRequest` deriving the signing key chain (`kDate`, `kRegion`, `kService`, `kSigning`); implement `SigV4Guard.canActivate` with the `±15 minute` skew check, header parsing, `constantTimeEquals` comparison, and the explicit `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` rejection.

## Acceptance criteria
- [ ] `SigV4Guard` rejects `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` with `InvalidArgumentError` per §2.4.6.
- [ ] Header-based path verifies signature against the `KeyService`-resolved secret; mismatch yields `SignatureDoesNotMatchError`.
- [ ] `X-Amz-Date` outside `±15 min` yields `RequestTimeTooSkewedError`.
- [ ] `Sigv4Verifier.constantTimeEquals` uses `crypto.timingSafeEqual`.
- [ ] `buildCanonicalRequest` matches the AWS reference fixture (cross-checked against `aws4.sign`).

## Tasks
- [TASK-0311] Define KeyService abstract and AccessKey interface
- [TASK-0312] Implement canonical-request builder and awsUriEncode
- [TASK-0313] Implement Sigv4Verifier
- [TASK-0314] Implement SigV4Guard header-based path
- [TASK-0315] Reject STREAMING-AWS4-HMAC-SHA256-PAYLOAD chunked uploads

## Test plan
- [TEST-0104] SigV4 canonical-request and verifier unit
- [TEST-0105] SigV4Guard header-based e2e
- [TEST-0106] Chunked-upload rejection e2e

## Dependencies
- Blocks: [STORY-0100], [STORY-0104], [STORY-0107], [STORY-0108], [STORY-0109], [STORY-0110]
- Blocked by: [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.4 (lines 1576–1982)
- Interfaces consumed: `KeyService.getSecret` (implementation in EPIC-03), `AccessDeniedError`, `InvalidArgumentError`, `RequestTimeTooSkewedError`, `SignatureDoesNotMatchError` (defined in STORY-0105)
- Interfaces produced: `KeyService`, `AccessKey`, `Sigv4Verifier`, `SigV4Guard`, `buildCanonicalRequest`, `MAX_SKEW_MS`, `STREAMING_SHA`
