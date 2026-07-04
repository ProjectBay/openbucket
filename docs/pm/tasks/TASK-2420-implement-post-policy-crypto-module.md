---
id: TASK-2420
title: Implement the POST-policy crypto module (mint, parse, evaluate, verify)
story: STORY-0802
status: backlog
type: implementation
size: M
---

## Description
Add the pure-crypto core for S3 browser POST uploads, symmetric with the
existing `buildPresignedUrl` / `verifyPresigned` pair in `presigned.ts`. It
mints a base64 POST policy + SigV4 signature from a credential, and — on the
serving side — parses the submitted policy, evaluates its `conditions` against
the submitted form fields, and re-derives and constant-time-compares the
signature. No Nest/HTTP/DB dependencies, so it is unit-testable in isolation.

## Files to create / modify
- `libs/nestjs/src/lib/s3/sigv4/presigned-post.ts` — new
- `libs/nestjs/src/lib/s3/sigv4/presigned-post.spec.ts` — new
- `libs/nestjs/src/lib/s3/sigv4/sigv4.verifier.ts` — modify (export/reuse `deriveSigningKey`, `constantTimeEquals` if not already public)

## Implementation notes
- Policy document shape (AWS-compatible):
  ```ts
  interface PostPolicy {
    expiration: string; // ISO-8601, e.g. 2026-07-02T12:00:00.000Z
    conditions: PostPolicyCondition[];
  }
  type PostPolicyCondition =
    | Record<string, string>                 // exact match: { key: 'uploads/a.png' }
    | ['eq', string, string]                 // ['eq', '$key', 'uploads/a.png']
    | ['starts-with', string, string]        // ['starts-with', '$key', 'uploads/']
    | ['content-length-range', number, number];
  ```
- Minting: `buildPresignedPost(input): { url: string; fields: Record<string,string> }`.
  - `input`: `{ accessKeyId, secretAccessKey, region, scheme, host, bucket, key, expiresIn, now, basePath?, contentType?, extraConditions?, successActionStatus?, successActionRedirect? }` (mirror `PresignInput`).
  - Build `credentialScope = ${yyyymmdd}/${region}/s3/aws4_request`, `amzDate = now` in ISO-basic (reuse the `toISOString().replace(...)` shape from `buildPresignedUrl`).
  - `conditions` always include: `{ bucket }`, the `$key` condition (exact when no `${filename}`/wildcard intent, else `['starts-with','$key',prefix]`), `{ 'x-amz-algorithm': 'AWS4-HMAC-SHA256' }`, `{ 'x-amz-credential': `${accessKeyId}/${credentialScope}` }`, `{ 'x-amz-date': amzDate }`, plus caller `extraConditions` (`content-length-range`, `Content-Type`, `success_action_*`).
  - `policyB64 = Buffer.from(JSON.stringify(policy)).toString('base64')`.
  - **StringToSign for POST is literally `policyB64`** (unlike query presign, which hashes a canonical request). `signature = HMAC-SHA256(signingKey, policyB64)` hex, where `signingKey = deriveSigningKey(secret, credentialScope)`.
  - `url = ${scheme}://${host}${normalizedBasePath}/${awsUriEncode(bucket)}`; the mount prefix normalisation is identical to `buildPresignedUrl` (leading slash, no trailing, `''` for root).
  - `fields` = `{ key, 'x-amz-algorithm', 'x-amz-credential', 'x-amz-date', policy: policyB64, 'x-amz-signature': signature, ...contentType/success fields }`. The `file` part is NOT a field — the caller/browser appends it.
- Serving: three helpers.
  - `parsePostPolicy(policyB64: string): PostPolicy` — base64-decode + `JSON.parse`; throw `MalformedPolicyError` on bad base64/JSON or a missing `expiration`/`conditions`.
  - `evaluatePostPolicy(policy, fields, streamedBytes): void` — throws on the first violation:
    - `expiration` in the past → `AccessDeniedError('Policy expired')`.
    - each exact `{ name: value }` (and `['eq', '$name', value]`) must equal `fields[name]`; `bucket` special-cased against the route bucket.
    - each `['starts-with', '$name', prefix]` → `fields[name].startsWith(prefix)` (empty prefix allows anything).
    - `['content-length-range', min, max]` checked against `streamedBytes` (see [TASK-2422]) → `EntityTooSmallError`/`EntityTooLargeError`.
    - **Every submitted field except `file`, `policy`, `x-amz-signature`, and the AWS-reserved set must be covered by at least one condition; an uncovered field fails closed** (`AccessDeniedError`) — mirrors S3's "Invalid according to Policy" and the fail-closed stance of `conditionsMatch` in `policy-evaluator.ts`.
  - `verifyPostSignature(fields, secret): boolean` — recompute `HMAC(deriveSigningKey(secret, scopeFromCredential(fields['x-amz-credential'])), fields['policy'])` and `constantTimeEquals` against `fields['x-amz-signature']`; return `false` (never throw) on mismatch so the caller emits a generic error without leaking key existence — same contract as `verifyPresigned`.
- Edge cases / DoS: reject `x-amz-algorithm !== 'AWS4-HMAC-SHA256'`; validate the credential scope (`s3`/`aws4_request` terminator) exactly like `verifyPresigned`; cap `policy` decode to a sane size (e.g. 20 KB) before `JSON.parse` to bound parser work; treat `${filename}` substitution as a caller-side concern of [TASK-2422] (this module sees the already-substituted `key`).

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=presigned-post.spec` passes.
- [ ] A round-trip test (`buildPresignedPost` → `verifyPostSignature`) returns `true`; flipping one byte of `policy` or `x-amz-signature` returns `false`.
- [ ] `evaluatePostPolicy` throws the correct S3 error class for each of: expired policy, failed `starts-with $key`, out-of-range length, and an uncovered extra field.
- [ ] The module imports no `@nestjs/*`, `express`, or MikroORM symbols (pure crypto).

## Test obligations
- Unit: covered by [TEST-0802]
- E2E: covered by [TEST-0802]
- Conformance: N/A

## Dependencies
- Blocked by: reuse of `Sigv4Verifier.deriveSigningKey`/`constantTimeEquals` ([STORY-0612]) and the S3 error classes in `s3/errors/s3-error.ts`.

## References
- `docs/WHITEPAPER.md` §2.5–§2.6.
- `libs/nestjs/src/lib/s3/sigv4/presigned.ts` (`buildPresignedUrl`, `verifyPresigned`, `awsUriEncode` usage, mount normalisation).
- `libs/nestjs/src/lib/s3/sigv4/sigv4.verifier.ts`, `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts` (fail-closed pattern).
