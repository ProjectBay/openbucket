---
id: STORY-0802
title: Direct browser uploads (presigned POST)
epic: EPIC-09
status: backlog
size: M
risk: medium
---

## User story
As a developer embedding `@openbucket/nestjs` in an app, I want to mint an
S3-style presigned POST policy from `OpenBucketService.createPresignedPost(...)`
and have OpenBucket accept the resulting `multipart/form-data` browser upload
directly, so that end users' browsers stream files straight into the bucket
without proxying multi-gigabyte bodies through my app server.

## Description
Adds the S3 "browser-based upload using POST" flow (`PostObject`) which today is
a stub — `object.service.ts:338` throws `NotImplementedError('PostObject')`.
This Story produces two halves that are cryptographically symmetric: a minting
side, `OpenBucketService.createPresignedPost(bucket, opts)`, returning
`{ url, fields }` (a base64 policy document + `x-amz-signature` derived from the
root credential); and a serving side, a bucket-scope `POST /:bucket` endpoint
that streaming-parses the form, re-derives and constant-time-compares the
signature, evaluates the POST-policy `conditions` (`content-length-range`,
`starts-with`/exact `$key`, `Content-Type`, `bucket`), and persists the object
through the existing two-phase writer. Authentication for this flow lives in the
form body (not a header or query signature), so it deliberately bypasses the
header/query branch of `SigV4Guard` and instead authenticates inside a new
`PostObjectInterceptor`, then reuses the EPIC-08 `evaluatePolicy` bucket-policy
check so the security posture is preserved. No schema migration is required.

## Acceptance criteria
- [ ] `OpenBucketService.createPresignedPost('b', { key, expiresIn, conditions })` returns `{ url, fields }` where `url` is the path-style bucket endpoint (honouring `mountPath`) and `fields` contains `key`, `policy`, `x-amz-algorithm`, `x-amz-credential`, `x-amz-date`, and `x-amz-signature`.
- [ ] A `multipart/form-data` POST to `/:bucket` carrying those exact fields plus a `file` part stores the object and returns 204 (or 201 `<PostResponse>` / a 303 redirect per `success_action_status` / `success_action_redirect`).
- [ ] Tampering with any signed field, an expired `policy.expiration`, or an unknown `x-amz-credential` access-key is rejected with `AccessDenied` / `SignatureDoesNotMatch` and the object is NOT written.
- [ ] A `file` whose streamed byte count falls outside `["content-length-range", min, max]` is rejected (`EntityTooLarge` / `EntityTooSmall`) and no partial blob is committed; the cap is enforced on streamed bytes, never trusting the multipart `Content-Length`.
- [ ] A `key` that violates an exact or `starts-with` `$key` condition is rejected with `AccessDenied`; `${filename}` in the `key` field is substituted with the uploaded part's filename.
- [ ] An existing bucket policy is still enforced for the POST (action `s3:PutObject`) via the EPIC-08 `evaluatePolicy`, with `accessKeyId` resolved from `x-amz-credential`.
- [ ] `SigV4Guard` continues to reject every non-PostObject S3 request that lacks a valid header/query signature (no bypass regression), verified by the existing sigv4 suite still passing.

## Tasks
- [TASK-2420] Implement the POST-policy crypto module (mint, parse, evaluate, verify)
- [TASK-2421] Add OpenBucketService.createPresignedPost facade + option types
- [TASK-2422] Build the streaming multipart PostObjectInterceptor with content-length-range enforcement
- [TASK-2423] Wire the PostObject endpoint, SigV4 deferral, and object persistence
- [TASK-2424] Document direct browser uploads (usage + security notes)

## Test plan
- [TEST-0802] Presigned POST browser-upload end-to-end

## Dependencies
- Blocks: _none_
- Blocked by: EPIC-08 authz must remain intact — reuses `evaluatePolicy` ([TASK-2120]) and `KeyService.getSecret`; must not regress `assertMandatorySignedHeaders` / `SigV4Guard` ([TASK-2121]) or the log-redaction of query auth ([TASK-2150]).

## References
- `docs/WHITEPAPER.md` §2.5 (presigned URLs), §2.6 (browser-based POST uploads).
- Existing symmetry to mirror: `buildPresignedUrl` / `verifyPresigned` in `libs/nestjs/src/lib/s3/sigv4/presigned.ts`.
- Stub being realised: `postObject` at `libs/nestjs/src/lib/domain/objects/object.service.ts:338`; dispatch scaffold in `libs/nestjs/src/lib/s3/controllers/object.controller.ts:121` and `libs/nestjs/src/lib/s3/routing/operation-resolver.ts:122` (`PostObject`).
- Reused write path: `ObjectService.putFromStream` / `writer.put` (`object.service.ts:286`); verifier pattern in `libs/nestjs/src/lib/s3/object/put-object.interceptor.ts`.
- Reused authz: `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts`, `operation-action.ts` (`PostObject` → `s3:PutObject`), `libs/nestjs/src/lib/s3/sigv4/sigv4.verifier.ts` (`deriveSigningKey`, `constantTimeEquals`), `libs/nestjs/src/lib/s3/sigv4/key.service.ts`.
- New runtime dep: `busboy` (streaming multipart parser; already transitive via `multer`). Optional conformance tooling: `@aws-sdk/client-s3` + `@aws-sdk/s3-presigned-post`.
- Interfaces produced: `OpenBucketService.createPresignedPost`, `buildPresignedPost`, `evaluatePostPolicy`, `verifyPostSignature`, `PostObjectInterceptor`.
