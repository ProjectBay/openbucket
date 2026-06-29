---
id: STORY-0117
title: CORS preflight handling per bucket
epic: EPIC-02
status: done
size: S
risk: medium
---

## User story
As a browser-based S3 client, I want `OPTIONS /:bucket/:key*` to return CORS headers synthesised from the bucket's stored CORS configuration without needing SigV4, so that fetch() preflights against the OpenBucket endpoint succeed when the bucket policy allows them.

## Description
Realize §2.9 of the white paper. Implement `CorsController.preflight` that resolves the bucket via `RouteResolver`, looks up `bucketRow.corsConfiguration`, matches origin + method + requested headers against rules using `globMatch` (single `*` wildcard, AWS semantics), and emits `Access-Control-Allow-*` plus `Vary` headers. OPTIONS bypasses `SigV4Guard`. The S3 module must mount `CorsController` *before* `ObjectController` so OPTIONS is captured here.

## Acceptance criteria
- [ ] `OPTIONS /:bucket/:key*` without `Origin` and `Access-Control-Request-Method` returns 200 with `Allow: GET, HEAD, PUT, POST, DELETE, OPTIONS`.
- [ ] With CORS headers present, the handler finds the first matching `CORSRule` or throws `AccessDeniedError('CORSResponse: This CORS request is not allowed.')`.
- [ ] Missing bucket → `NoSuchBucketError`; bucket without CORS config → `NoSuchCORSConfigurationError('CORSResponse: CORS is not enabled for this bucket.')`.
- [ ] Response sets `Access-Control-Allow-Origin` (either the literal origin or `*`), `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Expose-Headers`, `Access-Control-Max-Age`, and `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`.

## Tasks
- [TASK-0359] Implement CorsController preflight handler
- [TASK-0360] Implement glob/origin matcher helpers
- [TASK-0361] Mount CorsController before ObjectController in s3.module

## Test plan
- [TEST-0131] CORS preflight unit
- [TEST-0132] CORS preflight e2e
- [TEST-0133] CORS preflight conformance (curl / fetch)

## Dependencies
- Blocked by: [STORY-0101], [STORY-0105], [STORY-0106], [STORY-0112], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.9 (lines 2585–2685)
- Interfaces consumed: `BucketService` (EPIC-03), `RouteResolver` (STORY-0101), `AccessDeniedError`, `NoSuchBucketError`, `NoSuchCORSConfigurationError` (STORY-0105)
- Interfaces produced: `CorsController`, `matchOrigin`, `matchHeader`, `globMatch`
