---
id: TEST-0702
title: Bucket-policy evaluation and SignedHeaders coverage
covers: [STORY-0702, TASK-2120, TASK-2121]
status: ready
level: e2e
---

## Goal
Verify that bucket policies are actually enforced on the S3 request path (audit finding [11], CWE-862) — an explicit `Deny` and `Condition` clause block the operation — and that both SigV4 paths require `host` and every wire-present `x-amz-*` header to be covered by `SignedHeaders` (audit finding [8], CWE-345). Prove the fixes without regressing compliant SDK/CLI traffic.

## Setup
- Jest + supertest against a booted `@openbucket/nestjs` app; in-memory SQLite; a single root access key (`accessKeyId`/`secretAccessKey`) from the test fixture.
- Helpers: `sign(req)` (header SigV4 via `aws4`) and `presign(op)` (uses the project presigner) to mint valid signed requests. A `putPolicy(bucket, doc)` helper drives `PUT /:bucket?policy` with a `PolicyDocument` body.
- Unit cases exercise `evaluatePolicy` (`policy-evaluator.ts`), the action map (`operation-action.ts`), and `assertMandatorySignedHeaders` (`signed-headers.ts`) directly.

## Cases

### Bucket-policy evaluation — [TASK-2120]
1. Given a bucket with no policy, when a signed `GET /b/key` is sent, then it returns `200` (default-allow; no regression for the root credential).
2. Given `putPolicy(b, { Effect: Deny, Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" })`, when a signed `GET /b/key` is sent, then it returns `403 AccessDenied`; after `DELETE /b?policy`, the same GET returns `200`.
3. Given a policy with both a matching `Allow s3:*` and a matching `Deny s3:DeleteObject` on `arn:aws:s3:::b/*`, when a signed `DELETE /b/key` is sent, then it returns `403` (deny-overrides), while a signed `GET /b/key` returns `200`.
4. Unit: `evaluatePolicy` maps `req.openbucket.operation='GetObject'` → action `s3:GetObject` and resource `arn:aws:s3:::b/key`; a `Deny` with `Action: "s3:Get*"` (glob) matches and denies.
5. Given `Deny s3:GetObject` with `Condition: { Bool: { "aws:SecureTransport": "false" } }`, when the GET arrives over plain HTTP then it returns `403`; when it arrives over TLS (or `X-Forwarded-Proto: https` behind the trusted loopback proxy) it returns `200`.
6. Given `Deny s3:GetObject` with `Condition: { NotIpAddress: { "aws:SourceIp": "203.0.113.0/24" } }`, when the request source IP is outside the CIDR then it returns `403`; inside the CIDR it returns `200`.
7. Unit: an unknown condition operator/key under a `Deny` statement fails closed (treated as matched → deny), never silently allowing.
8. Given a `PutBucketPolicy` followed by `GetBucketPolicy`, the document still round-trips verbatim (no behavioral regression to storage in [STORY-0111]) while now also being enforced per cases 2–6.

### SignedHeaders coverage — [TASK-2121]
9. Given a header-signed `GET /b/key` whose `Authorization` `SignedHeaders=x-amz-content-sha256;x-amz-date` (omits `host`), when sent then it returns `403 AccessDenied` (host must be signed).
10. Given a presigned `GET /b/key` whose `X-Amz-SignedHeaders` omits `host`, when sent then it returns `403`.
11. Given a header-signed request carrying `x-amz-meta-foo` on the wire but omitting it from `SignedHeaders`, when sent then it returns `403` (every present `x-amz-*` header must be covered); the same request with `x-amz-meta-foo` included in `SignedHeaders` and the signature recomputed returns `200`.
12. Unit: `assertMandatorySignedHeaders(['x-amz-date'], { host, 'x-amz-date' })` throws; `assertMandatorySignedHeaders(['host','x-amz-date'], { host, 'x-amz-date' })` returns without throwing; header names compare case-insensitively.
13. Regression: a normal `aws4`-signed request (signs `host` + all `x-amz-*`) and a project-minted presigned URL both continue to return `200`/expected status — no conformance regression.

## Tooling
- Framework: jest, supertest, aws4 (SigV4 cross-signer)
- Runner: `nx test nestjs --testPathPattern='policy-evaluator|signed-headers'` (unit) and `nx e2e nestjs-e2e --testPathPattern='authz|sigv4'` (e2e)

## Pass criteria
- [ ] All 13 cases pass.
- [ ] An explicit `Deny` (cases 2–3) and each supported `Condition` (cases 5–6) demonstrably block the operation.
- [ ] Both SigV4 paths reject `host`-omitted and `x-amz-*`-omitted SignedHeaders (cases 9–11), while compliant traffic is unaffected (case 13).

## References
- White-box security audit, 2026-07-04 — findings [11] (CWE-862) and [8] (CWE-345).
- `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts`, `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts`, `libs/nestjs/src/lib/s3/sigv4/signed-headers.ts` (produced by [TASK-2120]/[TASK-2121])
