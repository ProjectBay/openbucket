---
id: TASK-2422
title: Build the streaming multipart PostObjectInterceptor with content-length-range enforcement
story: STORY-0802
status: backlog
type: implementation
size: L
---

## Description
Add a NestInterceptor that streaming-parses a `multipart/form-data` browser POST
with `busboy`, collects the policy fields, authenticates the request against the
submitted POST policy + signature, and produces a verified, size-capped
`Readable` of the `file` part for the handler to persist. It is the POST-flow
analogue of `PutObjectInterceptor` and reuses that interceptor's md5/sha256/size
verifier transform so the write path is identical.

## Files to create / modify
- `libs/nestjs/src/lib/s3/object/post-object.interceptor.ts` — new
- `libs/nestjs/src/lib/s3/object/post-object.interceptor.spec.ts` — new
- `libs/nestjs/src/lib/s3/object/put-object.interceptor.ts` — modify (extract the reusable md5/sha256/size-cap `Transform` into a shared helper, e.g. `object/body-verifier.ts`, so both interceptors share it)
- `libs/nestjs/src/lib/s3/object/body-verifier.ts` — new (extracted verifier factory + `PutObjectStreamContext`)
- `package.json` — modify (add `busboy` + `@types/busboy` as an explicit dependency)

## Implementation notes
- Trigger shape (guard against consuming other bodies): only intercept when
  `req.method === 'POST'`, `req.openbucket.s3Scope === 's3-bucket'`,
  `content-type` starts with `multipart/form-data`, and `delete` is NOT a query
  flag. Otherwise `return next.handle()` untouched (bulk `DeleteObjects` keeps
  its XML path).
- Parsing (`busboy` with hard limits — CWE-400 / CWE-770):
  - `limits: { files: 1, fields: 20, fieldSize: 8 * 1024, fieldNameSize: 128, parts: 25 }`. A `filesLimit`/`fieldsLimit`/`partsLimit` event → `MalformedPOSTRequestError`/`InvalidArgumentError`.
  - Collect text fields into `fields: Record<string,string>` **until** the `file` event fires. Per the S3 rule the `file` field must be last; any field arriving after `file` is ignored (do not let it mutate an already-evaluated policy).
  - On `file`:
    1. Substitute `${filename}` in `fields.key` with the part's `filename` (sanitised: reject `..`, strip leading `/`), matching S3 semantics.
    2. `parsePostPolicy(fields.policy)` and validate `x-amz-algorithm`/credential scope ([TASK-2420]).
    3. Resolve the secret via `KeyService.getSecret(accessKeyIdFromCredential)`; if absent or `verifyPostSignature(fields, secret) === false`, destroy the stream and throw `SignatureDoesNotMatchError` (generic, no key-existence leak).
    4. `evaluatePostPolicy(policy, fields, /*streamedBytes settled later*/)` for the non-length conditions up front; enforce `content-length-range` **during** streaming.
    5. Pipe the file stream through the shared body-verifier `Transform` (md5+sha256+byte count) with `maxBytes = min(policyMax, config.maxObjectSizeMb*MiB)`; on `bytes > maxBytes` → `EntityTooLargeError`; on `flush` if `bytes < policyMin` → `EntityTooSmallError`. **Never trust the multipart `Content-Length` header** — it covers the whole envelope, not the file; the cap is on streamed bytes only.
  - Expose the result on the request the same way `PutObjectInterceptor` does: `req.openbucketPutCtx = { stream, hashes, size }`, and stamp `req.openbucket.accessKeyId` + a resolved `{ bucket, key, contentType, successAction }` onto e.g. `req.openbucketPost` for the handler.
- Backpressure & lifecycle: reuse the `PutObjectInterceptor` posture — pull-based `pipe`, the 30s `STALL_TIMEOUT_MS` socket watchdog, and `req.on('aborted'|'error', fail)` tearing down the verifier and rejecting the pending hash/size promises. Do not add a `data` listener (keeps backpressure pull-based, per TEST-0316).
- DoS / security specifics:
  - Cap the buffered non-file fields (busboy `fieldSize`) so a huge `policy` cannot exhaust memory before `JSON.parse`.
  - Reject a request with two `file` parts (`files: 1`).
  - Do not honour any `Authorization`/cookie/JWT on this route — authentication is the POST policy alone; the interceptor must not fall back to ambient credentials.
  - Enforce the `key` through the existing `RouteResolver` limits (≤1024 bytes) and let `key-codec` per-segment 255-byte checks apply on write.
- Return value: the interceptor only prepares the stream; persistence + response shaping is [TASK-2423].

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=post-object.interceptor.spec` passes, including: valid upload streams to `openbucketPutCtx`; tampered signature rejected; file exceeding the range destroyed with `EntityTooLarge`; second `file` part rejected.
- [ ] `PutObjectInterceptor` still passes its existing spec after the verifier extraction (`nx test nestjs --testPathPattern=put-object.interceptor.spec`).
- [ ] No `data` event listener is attached to `req` (grep the file); backpressure remains pull-based.
- [ ] `busboy` appears in `package.json` dependencies.

## Test obligations
- Unit: covered by [TEST-0802]
- E2E: covered by [TEST-0802]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2420]

## References
- `libs/nestjs/src/lib/s3/object/put-object.interceptor.ts` (verifier `Transform`, stall watchdog, `openbucketPutCtx`, backpressure).
- `libs/nestjs/src/lib/s3/sigv4/key.service.ts` (`getSecret`), `libs/nestjs/src/lib/s3/routing/route-resolver.ts` (key limits).
- `docs/WHITEPAPER.md` §2.6, §4.1.2 (streaming ingest), §4.7 (highWaterMark).
