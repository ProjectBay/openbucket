---
id: STORY-0007
title: Implement request classifier middleware (S3 vs admin vs SPA)
epic: EPIC-01
status: done
size: M
risk: medium
---

## User story
As a developer, I want a single middleware to decide `req.openbucket.kind` (`'s3' | 'admin' | 'spa'`) and populate `bucket`, `key`, `addressingStyle`, and `s3Scope` once per request, so that controllers, guards, the logger, and exception filters all branch on a single typed field instead of re-parsing the URL.

## Description
Implement `apps/backend/src/common/middleware/request-classifier.middleware.ts` per §1.5 with the documented decision tree:
1. `/api/admin/*` → `kind = 'admin'`
2. `/admin/*` (not under `/api/admin`) → `kind = 'spa'`
3. Host header matches `<label>.<endpoint>` where `<label>` passes `BUCKET_LABEL = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/` → vhost S3
4. Otherwise → path-style S3 (`/` is `s3-service`; first segment is bucket)
Stash `endpointSuffix` once in the constructor. Set `ctx.receivedAt = Date.now()` first. Provide `stripPort` (IPv6-aware) and `decodeKey` (swallowing malformed percent-encoding) helpers. The middleware must never throw — bucket existence and key validity are not its job.

## Acceptance criteria
- [ ] Decision tree matches §1.5 cases 1–4 in order.
- [ ] `BUCKET_LABEL` regex is exactly `/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/`.
- [ ] `ctx.receivedAt` is assigned to `Date.now()` before any branch returns.
- [ ] vhost match populates `bucket`, `key` (percent-decoded), `addressingStyle='virtual-host'`, `s3Scope='s3-bucket' | 's3-object'`.
- [ ] Path-style `/` resolves to `kind='s3'`, `s3Scope='s3-service'`, no bucket/key.
- [ ] Malformed percent-encoded path segment falls through to raw `pathSegment` rather than throwing.
- [ ] IPv6 host headers in brackets are stripped of port correctly.

## Tasks
- [TASK-0015] Implement RequestClassifierMiddleware class
- [TASK-0016] Implement stripPort helper
- [TASK-0017] Implement decodeKey helper
- [TASK-0018] Wire endpoint suffix from AppConfigService

## Test plan
- [TEST-0007] Classifier decision tree (unit)
- [TEST-0008] Classifier observable behavior end-to-end (e2e)

## Dependencies
- Blocks: [STORY-0004], [STORY-0009], [STORY-0010], [STORY-0013]
- Blocked by: [STORY-0005], [STORY-0006], [STORY-0011]

## Status note
Closed at the M0→M1 boundary. Code (TASK-0015..0018) and the unit test
(TEST-0007, 14 cases) were already complete and green; `stripPort`/`decodeKey`
were exported for direct unit testing (no behaviour change). TEST-0008
(classifier **e2e**) now passes via `openbucket-backend-e2e/src/classifier.e2e-spec.ts`,
asserting admin→JSON, path-style `/` and `/bucket/key`→S3 XML, and vhost
resolution from the Host header, each carrying matching `x-request-id` /
`x-amz-request-id`. TEST-0008 case 3 (SPA shell HTML) is deferred to the
build-present conformance image (EPIC-06); there is no `dist/spa` in M0.

## References
- `docs/WHITEPAPER.md` §1.5 (lines 383–490)
- Interfaces consumed: `AppConfigService.endpoint` (STORY-0011), `OpenBucketRequestContext` (STORY-0005)
- Interfaces produced: `RequestClassifierMiddleware` (consumed by STORY-0004, STORY-0008); `req.openbucket.kind`/`bucket`/`key`/`addressingStyle`/`s3Scope` contract (consumed across EPIC-02, EPIC-05)
