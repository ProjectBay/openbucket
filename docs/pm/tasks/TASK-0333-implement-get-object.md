---
id: TASK-0333
title: Implement GetObject route
story: STORY-0109
status: done
type: implementation
size: M
---

## Description
Implement `GET /:bucket/:key+` (`GetObject`) per §2.8.3 — honours `Range`, conditional headers; streams the body via the EPIC-04 pipe primitive; bypasses the `XmlInterceptor` outbound branch (handler writes directly and returns `undefined`, per §2.3.4 lines 1570–1572).

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (GetObject branch)

## Implementation notes
- Route: `| GET  | `/:bucket/:key+` | — | `GetObject` | Honours `Range`, `If-Match`, etc. |` (§2.8.3 line 2548).
- Per §2.1.1 (line 1194): `return this.objects.getObject(req, res, bucket, key);`.
- Apply `@S3Operation('GetObject')`.
- Per §2.3.4 (lines 1568–1572): "For `GET /<bucket>/<key>` the handler writes directly to the `Response` stream via the streaming agent's pipe primitive [see §3] and returns `undefined`; the interceptor short-circuits."
- Conditional headers: `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since` (failures → `PreconditionFailedError` or 304 per AWS).
- `Range: bytes=…` → 206 Partial Content; invalid range → `InvalidRangeError`.

## Acceptance criteria
- [ ] Range requests return 206 with `Content-Range`.
- [ ] `If-None-Match` matching the ETag returns 304 with no body.
- [ ] Body is streamed (no buffering).
- [ ] `XmlInterceptor` does not wrap the response.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0103], [STORY-0104], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2548), §2.3.4 (lines 1568–1572), §2.1.1 (lines 1180–1195)
