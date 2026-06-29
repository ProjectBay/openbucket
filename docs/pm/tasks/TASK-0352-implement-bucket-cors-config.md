---
id: TASK-0352
title: Implement bucket CORS configuration (GET/PUT/DELETE ?cors)
story: STORY-0112
status: done
type: implementation
size: S
---

## Description
Implement the three bucket CORS configuration operations per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2518–2520):
  - `| GET  | `/:bucket` | `cors` | `GetBucketCors` |`
  - `| PUT  | `/:bucket` | `cors` | `PutBucketCors` |`
  - `| DELETE | `/:bucket` | `cors` | `DeleteBucketCors` |`
- `PutBucketCors` is in `XML_REQUEST_OPS` (§2.3.2 line 1371). Body: `<CORSConfiguration><CORSRule><AllowedOrigin>…</AllowedOrigin><AllowedMethod>…</AllowedMethod><AllowedHeader>…</AllowedHeader><ExposeHeader>…</ExposeHeader><MaxAgeSeconds>…</MaxAgeSeconds></CORSRule></CORSConfiguration>`.
- `CORSRule`, `AllowedOrigin`, `AllowedMethod`, `AllowedHeader`, `ExposeHeader` already hinted as arrays by `XmlParser` (§2.3.3 lines 1486–1493).
- Apply `@S3Operation('GetBucketCors' | 'PutBucketCors' | 'DeleteBucketCors')`.
- GET with no config → `NoSuchCORSConfigurationError`.
- The persisted document is consumed by `CorsController` (STORY-0117).

## Acceptance criteria
- [ ] PUT persists the document via `BucketService.setCorsConfiguration(bucket, config)`.
- [ ] GET returns the persisted document or `NoSuchCORSConfiguration`.
- [ ] DELETE clears and returns 204.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0121]
- Conformance: covered by [TEST-0122]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2518–2520), §2.3.3 (lines 1486–1493)
