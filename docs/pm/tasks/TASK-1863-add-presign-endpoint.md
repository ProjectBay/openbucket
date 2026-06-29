---
id: TASK-1863
title: Add the object presign-URL admin endpoint + `PresignedUrlDto`
story: STORY-0612
status: done
type: implementation
size: M
---

## Description
Add an admin endpoint that mints a SigV4 query-signed (presigned) GET URL for an object, so the SPA can produce share/download links without proxying bytes through the admin API. Reuse the project's canonical-request + signing code from `s3/sigv4` so the URL verifies against the existing presigned verifier (`verifyPresigned`). The signing key is the root access key the S3 surface already uses.

## Files to create / modify
- `apps/openbucket-backend/src/admin/objects/dto/presign.dto.ts` — new (`PresignRequestDto { expiresIn: number }`)
- `apps/openbucket-backend/src/admin/objects/dto/presigned-url.dto.ts` — new (`PresignedUrlDto { url: string; expiresAt: string }`)
- `apps/openbucket-backend/src/s3/sigv4/presigned.ts` — modify ONLY if a signing/generator helper must be factored out (the file currently exposes `verifyPresigned` + `MAX_EXPIRES`; add a `buildPresignedUrl(...)` generator alongside, reusing `buildCanonicalRequest` so sign and verify stay symmetric)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.ts` — modify (add the `presign` handler)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.spec.ts` — modify (cases under [TASK-1866])

## Implementation notes
- Constant being honored (verbatim, `presigned.ts`): `export const MAX_EXPIRES = 7 * 24 * 60 * 60; // AWS: max 7 days.` — cap `expiresIn` at `MAX_EXPIRES`; reject `< 1`.
- Signing must be symmetric with the verifier `verifyPresigned`, which rebuilds the string-to-sign as:
  `['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonical)].join('\n')` where `canonical = buildCanonicalRequest({ method, pathname, query (with all X-Amz-* except X-Amz-Signature), headers, signedHeaders:['host'], payloadHash:'UNSIGNED-PAYLOAD' })` and `credentialScope = '<date>/<region>/s3/aws4_request'`. The derived key chain is `kDate=HMAC('AWS4'+secret, date) → kRegion → kService('s3') → kSigning('aws4_request')`, signature `= HMAC(kSigning, stringToSign)` hex. The generator MUST mirror this exactly so a generated URL passes `verifyPresigned`.
- Query params to emit: `X-Amz-Algorithm=AWS4-HMAC-SHA256`, `X-Amz-Credential=<accessKeyId>/<date>/<region>/s3/aws4_request`, `X-Amz-Date=<amzDate>`, `X-Amz-Expires=<expiresIn>`, `X-Amz-SignedHeaders=host`, then `X-Amz-Signature=<sig>` last. Pull the access key + secret from the same `KeyService` the verifier uses (`keys.getSecret(accessKeyId)`); the root access key id is the configured `ROOT_ACCESS_KEY_ID`.
- Route: `POST /api/admin/buckets/:name/objects/*:presign` (action suffix on the key `*` path; if path-to-regexp 8 rejects the suffix on `*`, fall back to a query flag `POST …/objects/*?presign` and document it). Body `{ expiresIn }`. Key resolved via `rawTail`/`decodeOnce`.
- Response: `PresignedUrlDto { url: string; expiresAt: string }` where `expiresAt = new Date(now + expiresIn*1000).toISOString()`.
- Globally-unique operationId (method-name factory): `presignObject`.
- Validation = **400 ValidationFailed** (`expiresIn` `z.number().int().min(1)`, capped to `MAX_EXPIRES` server-side; `.strict()` body).
- Audit: presign is read-shaped but mints a credential-bearing URL — emit `object.presigned` (`{ subject, bucket, key, expiresIn }`); confirm/add the catalogue entry in [TASK-1864].
- Decorators: `@ApiOperation({ operationId:'presignObject' })` + `@ApiParam({ name:'path' })` + `@ApiOkResponse({ type: PresignedUrlDto })`.

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) lists `presignObject`; zero operationId collisions.
- [ ] `nx test openbucket-backend --testPathPatterns=objects-admin.controller.spec` (Node 20) passes ([TASK-1866]); a generated URL is accepted by `verifyPresigned` (round-trip assertion).
- [ ] `expiresIn > MAX_EXPIRES` is capped (or 400); `expiresIn < 1` → 400.
- [ ] After [TASK-1865], `nx run api-client:check` is byte-equal.

## Test obligations
- Unit: covered by [TEST-0612] (controller + generator/verifier round-trip; via [TASK-1866]).
- E2E: covered by [TEST-0612] (presign then GET the URL through the booted S3 surface).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1862] (same controller file — land sequentially), [STORY-0612] deps ([EPIC-06] shipped the SigV4 stack)

## References
- UX review 2026-06-22 (power-user — share/presigned links).
- `apps/openbucket-backend/src/s3/sigv4/presigned.ts` (`verifyPresigned`, `MAX_EXPIRES`, string-to-sign + key chain), `s3/sigv4/canonical-request.ts` (`buildCanonicalRequest`), `s3/sigv4/key.service.ts` (`getSecret`), `admin/objects/objects-admin.controller.ts`.
- See `[[project_admin_api_spec_drift]]`.
