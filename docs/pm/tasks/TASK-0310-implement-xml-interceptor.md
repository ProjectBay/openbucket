---
id: TASK-0310
title: Implement XmlInterceptor
story: STORY-0102
status: done
type: implementation
size: M
---

## Description
Implement `XmlInterceptor` that buffers up to 256 KB of inbound XML when the operation is in `XML_REQUEST_OPS`, parses it via `XmlParser`, attaches the result as `(req as any).xmlBody`, and on the outbound side wraps POJO returns in `XmlSerializer` while passing `Buffer` and `{ __raw: true }` envelopes through unchanged.

## Files to create / modify
- `apps/backend/src/s3/xml/xml.interceptor.ts` — new

## Implementation notes
- Verbatim from §2.3.2 (lines 1353–1461):
  ```ts
  const MAX_XML_BYTES = 256 * 1024; // 256 KB; any S3 config doc fits well inside.

  const XML_REQUEST_OPS = new Set([
    'CreateBucket',            // <CreateBucketConfiguration>
    'PutBucketCors',
    'PutBucketLifecycleConfiguration',
    'PutBucketVersioning',
    'PutBucketTagging',
    'PutBucketReplication',
    'PutBucketEncryption',
    'PutBucketAcl',
    'PutBucketPolicy',         // JSON, not XML — skipped by op-name match
    'PutObjectLockConfiguration',
    'PutObjectTagging',
    'PutObjectRetention',
    'PutObjectLegalHold',
    'CompleteMultipartUpload',
    'DeleteObjects',           // <Delete><Object>... — POST ?delete
  ]);
  ```
- Inbound gate: `op !== undefined && XML_REQUEST_OPS.has(op) && req.method !== 'GET' && req.method !== 'HEAD'`.
- `readXmlBody`: stream `req` chunks, track `received`, destroy + reject with `MalformedXMLError('XML body too large')` on exceeding `MAX_XML_BYTES`; on `end`, parse via `XmlParser` and reject parse failures as `MalformedXMLError`.
- Outbound: `undefined`/`null`/`Buffer`/`string` pass through. `__raw` envelope passes through. POJO with optional `__root` field is serialized; sets `Content-Type: application/xml` and `Content-Length`.
- Streaming `GET /<bucket>/<key>` handlers write directly to the `Response` and return `undefined`; the interceptor short-circuits (§2.3.4 lines 1568–1572).

## Acceptance criteria
- [ ] Bodies > 256 KB are rejected with `MalformedXMLError`.
- [ ] `XML_REQUEST_OPS` matches the set in §2.3.2 verbatim.
- [ ] `(req as any).xmlBody` is populated on success.
- [ ] Buffer and `{__raw}` outputs pass through unchanged.

## Test obligations
- Unit: covered by [TEST-0102]
- E2E: covered by [TEST-0103]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0308], [TASK-0309], [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.3.2 (lines 1350–1461)
