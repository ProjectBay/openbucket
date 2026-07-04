---
id: TEST-0802
title: Presigned POST browser-upload end-to-end
covers: [STORY-0802, TASK-2420, TASK-2421, TASK-2422, TASK-2423]
status: backlog
level: e2e
---

## Goal
Prove that a presigned POST minted by `OpenBucketService.createPresignedPost`
is accepted by the `POST /:bucket` endpoint, that every condition
(`content-length-range`, `starts-with $key`, exact fields, `expiration`) and the
signature are enforced fail-closed, that the stored object matches the streamed
bytes, and that the change introduces no SigV4 or bucket-policy regression.

## Setup
- Nest test app booting the `@openbucket/nestjs` module against a temp libsql DB
  + temp FS blob root (the existing e2e harness), with a known
  `ROOT_ACCESS_KEY_ID`/`ROOT_SECRET_ACCESS_KEY`, `OPENBUCKET_REGION`, and a small
  `MAX_OBJECT_SIZE_MB` (e.g. 5) to exercise caps cheaply.
- A bucket `uploads` created via `OpenBucketService.createBucket`.
- Helper to POST a `FormData`: iterate `fields` in order, append `file` LAST
  (`undici`/`supertest` with a multipart body). Unit-level cases (TASK-2420)
  call `buildPresignedPost`/`evaluatePostPolicy`/`verifyPostSignature` directly.

## Cases
1. **Happy path (TASK-2420/2421/2423)** — mint with `{ key: 'a/${filename}', keyStartsWith: true, contentLengthRange: {min:1,max:5MiB} }`; POST a 1 KB `file` named `pic.png`. Then: response is 204; `openBucket.headObject('uploads','a/pic.png')` returns size 1024 and a strong `ETag`; `getObjectBuffer` bytes equal the sent bytes; `${filename}` was substituted.
2. **Signature tamper (TASK-2420/2422)** — flip one hex char of `fields['x-amz-signature']`; POST → 403 `SignatureDoesNotMatch`; `headObject` returns null (nothing written).
3. **Unknown credential (TASK-2420/2422)** — replace the access-key in `x-amz-credential` with an unknown id → 403, generic error (no key-existence leak).
4. **Expired policy (TASK-2420)** — mint with `now` in the past so `expiration` has passed (or `expiresIn` then advance a fake clock) → 403 `AccessDenied` "Policy expired"; nothing written.
5. **Over-range file (TASK-2422)** — policy `content-length-range` max = 2048; stream a 4 KB file → rejected `EntityTooLarge`; assert no partial blob is committed (`headObject` null, temp dir clean).
6. **Under-range file (TASK-2422)** — range min = 100; send 10 bytes → `EntityTooSmall`.
7. **content-length trust (TASK-2422)** — send a body whose multipart envelope `Content-Length` is small but whose `file` part streams past the cap (chunked) → still rejected on streamed bytes, proving the header is not trusted.
8. **starts-with $key violation (TASK-2420/2423)** — mint with `starts-with $key = 'a/'` but submit `key: 'b/evil'` → 403 `AccessDenied`; nothing written.
9. **Uncovered field fails closed (TASK-2420)** — add an extra form field not named by any condition → 403 (mirrors S3 "Invalid according to Policy").
10. **Field order (TASK-2422)** — a field sent AFTER the `file` part does not alter the already-evaluated key/policy (upload of the pre-file key still occurs, or is rejected consistently); two `file` parts → rejected (`files:1`).
11. **success_action_status / redirect (TASK-2423)** — mint with `successActionStatus:'201'` → response is 201 with a `<PostResponse>` XML body containing `Bucket`/`Key`/`ETag`; mint with `successActionRedirect` → 303 to that URL with `bucket`/`key`/`etag` query params.
12. **Bucket policy still enforced (TASK-2423)** — put an explicit `Deny s3:PutObject` bucket policy, then POST a valid form → 403; remove it → 204. Confirms EPIC-08 `evaluatePolicy` runs with `accessKeyId` resolved from the form.
13. **No SigV4 bypass regression (TASK-2423)** — a normal `PUT /:bucket/key` with a bad/absent Authorization header still returns 403; a non-multipart `POST /:bucket?delete` (bulk delete) still routes to `DeleteObjects` and requires a valid signature. Run the existing `sigv4` suite unchanged.
14. **mountPath (TASK-2421)** — in library mode with `mountPath:'/storage'`, the minted `url` is `.../storage/uploads` and the POST to that path succeeds.

## Tooling
- Framework: jest + supertest/undici for the multipart POST; optional `@aws-sdk/s3-presigned-post` cross-check that an AWS-SDK-minted policy verifies against our endpoint (conformance).
- Runner: `nx test nestjs` (unit: TASK-2420/2421/2422 specs) and `nx e2e nestjs-e2e` (wire cases).

## Pass criteria
- [ ] All 14 cases pass.
- [ ] `nx test nestjs --testPathPattern=sigv4` and the `put-object.interceptor` spec pass unchanged (no regression from the verifier extraction / guard deferral).
- [ ] No temp blob is left committed after any rejection case.

## References
- `docs/WHITEPAPER.md` §2.6 (browser-based uploads), §2.5 (presigned URLs).
- `libs/nestjs/src/lib/s3/sigv4/presigned-post.ts` (new), `post-object.interceptor.ts` (new), `open-bucket.service.ts`, `s3/authz/policy-evaluator.ts`.
