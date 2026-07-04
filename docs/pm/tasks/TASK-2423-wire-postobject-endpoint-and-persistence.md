---
id: TASK-2423
title: Wire the PostObject endpoint, SigV4 deferral, and object persistence
story: STORY-0802
status: backlog
type: implementation
size: M
---

## Description
Connect the pieces into a working `POST /:bucket` endpoint: route the
browser-form POST to a real `postObject` handler, defer `SigV4Guard` for this
one shape (auth lives in the body, verified by [TASK-2422]), re-use the EPIC-08
bucket-policy check with the credential resolved from the form, persist through
the two-phase writer, and emit the S3-correct success response.

## Files to create / modify
- `libs/nestjs/src/lib/s3/controllers/bucket.controller.ts` — modify (dispatch `POST /:bucket` with `multipart/form-data` to `objects.postObject`; attach `PostObjectInterceptor`)
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts` — modify (deferral branch for the PostObject shape)
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts` — modify (skip PostObject; policy is evaluated post-parse)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (implement `postObject`, replacing the `NotImplementedError` stub at line 338)
- `libs/nestjs/src/lib/s3/controllers/object.controller.ts` — modify (remove/redirect the object-scope `postObject` fallthrough at line 121 so PostObject is bucket-scope only)

## Implementation notes
- **Routing correction**: S3 browser POST targets the *bucket* root
  (`POST https://host/{bucket}`), with the key supplied as a form field — so the
  operation is **bucket-scope**, not object-scope. `operation-resolver.ts`
  currently only returns `PostObject` at object scope (line 122); update
  `resolveBucketOp`'s `POST` case to return `PostObject` when the request is
  `multipart/form-data` and lacks the `delete` flag (before the `CreateBucket`
  fallback). Keep the object-scope entry for backward-safety but the primary
  wire path is bucket-scope.
- `BucketController.post`: after the `delete` branch, when
  `content-type` starts with `multipart/form-data`, call
  `this.objects.postObject(req, res, bucket)`; annotate the method (or a
  dedicated one) with `@UseInterceptors(PostObjectInterceptor)`. `@S3Throttled()`
  on the controller already applies the S3 rate limit — keep it.
- **SigV4 deferral (security-sensitive, keep tightly scoped)**: in
  `SigV4Guard.canActivate`, before the header/query branch, detect the exact
  PostObject shape — `req.method === 'POST'`, `req.openbucket.s3Scope === 's3-bucket'`,
  `content-type` startsWith `multipart/form-data`, no `delete` query — and
  `return true` (authentication deferred to `PostObjectInterceptor`). Any other
  request still flows through `checkHeader`/`checkPresigned`; the existing sigv4
  spec must still pass to prove no bypass regression. Add a code comment tying
  this to STORY-0802 and stating that the interceptor is the fail-closed auth.
- `PolicyAuthorizationGuard`: it runs before the body is parsed, so
  `accessKeyId` is not yet known for PostObject. Have it `return true` (skip) for
  the PostObject shape, and instead evaluate the bucket policy **inside**
  `objects.postObject` (or at the tail of the interceptor) once
  `accessKeyId` + `key` are resolved: reuse `evaluatePolicy(policy, { action: 's3:PutObject', resource: arn:aws:s3:::${bucket}/${key}, principal: accessKeyId, secureTransport: req.secure, sourceIp: req.ip }, { defaultAllow: true })` and throw `AccessDeniedError` on deny — identical semantics to the guard so no authz regression.
- `objects.postObject(req, res, bucket)`:
  1. Assert bucket exists (`NoSuchBucketError`).
  2. Read `req.openbucketPutCtx` (verified stream) + `req.openbucketPost` (key, contentType, successAction) prepared by the interceptor.
  3. Evaluate the bucket policy (above).
  4. `await this.writer.put({ bucket, key, body: stream, contentType })` — the same two-phase writer `putFromStream` uses.
  5. Response per `success_action_redirect` (303 with `bucket`/`key`/`etag` query params) → else `success_action_status`: `201` returns a `<PostResponse><Location/><Bucket/><Key/><ETag/></PostResponse>` XML body, `200`/absent → 204 No Content. Set `ETag` header in all cases.
- Edge cases: missing `key` field → `InvalidArgumentError`; policy present but bucket has an explicit `Deny` → 403; writer failure mid-stream tears down the temp blob (existing two-phase writer guarantees no partial commit). Do not set CORS/`Access-Control-*` here beyond what EPIC-08 already governs — a browser cross-origin POST works because the form submit is a "simple request"; documenting a CORS story is out of scope ([TASK-2424] notes it).

## Acceptance criteria
- [ ] `POST /:bucket` with a valid minted form stores the object and returns 204 (or 201 XML / 303 redirect per success fields); `HEAD /:bucket/:key` afterwards returns the object with the correct `ETag`.
- [ ] The same POST with a mutated `x-amz-signature` returns 403 and writes nothing.
- [ ] A bucket with an explicit `Deny s3:PutObject` policy rejects the POST with 403.
- [ ] `object.service.ts` no longer throws `NotImplementedError('PostObject')`.
- [ ] `nx test nestjs --testPathPattern=sigv4` still passes (no SigV4 bypass regression).

## Test obligations
- Unit: covered by [TEST-0802]
- E2E: covered by [TEST-0802]
- Conformance: covered by [TEST-0802] (optional `@aws-sdk/s3-presigned-post` case)

## Dependencies
- Blocked by: [TASK-2420], [TASK-2421], [TASK-2422]

## References
- `libs/nestjs/src/lib/s3/controllers/bucket.controller.ts:86` (`@Post`), `libs/nestjs/src/lib/s3/controllers/object.controller.ts:121`.
- `libs/nestjs/src/lib/s3/routing/operation-resolver.ts:71,122`, `libs/nestjs/src/lib/s3/authz/operation-action.ts` (`PostObject` → `s3:PutObject`).
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts`, `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts`, `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts`.
- `libs/nestjs/src/lib/domain/objects/object.service.ts:286` (`putFromStream`/`writer.put`), `:338` (stub).
- `docs/WHITEPAPER.md` §2.6.
