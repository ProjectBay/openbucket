---
id: TASK-0321
title: Implement S3ExceptionFilter body
story: STORY-0106
status: done
type: implementation
size: M
---

## Description
Implement the body of `S3ExceptionFilter` per §2.7 — the boilerplate that registers it on the S3 controller tree is owned by EPIC-01.

## Files to create / modify
- `apps/backend/src/s3/errors/s3-exception.filter.ts` — new

## Implementation notes
- Verbatim from §2.7 (lines 2366–2468):
  ```ts
  const builder = new XMLBuilder({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    format: false,
    suppressEmptyNode: true,
    processEntities: true,
  });

  @Catch()
  export class S3ExceptionFilter implements ExceptionFilter { /* ... */ }
  ```
- `catch`:
  - Extract `req`/`res` via `host.switchToHttp()`.
  - `err = this.normalise(exception)`.
  - `requestId = (req as any).openbucket?.requestId ?? 'unknown'`.
  - `resource = this.resourceFor(req)`.
  - Log: 5xx → `logger.error({ code, requestId, message, stack }, 's3 internal error')`; else → `logger.debug({ code, requestId, message }, 's3 client error')`.
  - Build body via `XMLBuilder` with `{ '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' }, Error: { Code, Message, ...err.extra, Resource, RequestId, HostId: requestId } }`.
  - `if (res.headersSent) { res.destroy(err); return; }`.
  - Set `status`, `Content-Type: application/xml`, `x-amz-request-id`, `Content-Length`.
  - **HEAD parity**: `if (req.method === 'HEAD') res.end(); else res.end(body);`.
- `normalise`:
  - `S3Error` → pass through.
  - `HttpException`: build wrapped `InternalError`, override `httpStatus`, `code` (`405→MethodNotAllowed`, `404→NoSuchKey`, else `InternalError`), `message`.
  - else → new `InternalError()`.
- `resourceFor`: `/${bucket}/${keyRaw}` if both, `/${bucket}` if just bucket, else `req.originalUrl` or `'/'`.

## Acceptance criteria
- [ ] Sample emitted body matches §2.7 lines 2473–2483 (key fields `Code`, `Message`, `Resource`, `RequestId`, `HostId`).
- [ ] HEAD on error: status + headers only, no body.
- [ ] `headersSent` triggers `res.destroy(err)`.
- [ ] 5xx logged at error; 4xx at debug.

## Test obligations
- Unit: covered by [TEST-0110]
- E2E: covered by [TEST-0110]
- Conformance: covered transitively by every conformance plan

## Dependencies
- Blocked by: [STORY-0105], [EPIC-01]

## References
- `docs/WHITEPAPER.md` §2.7 (lines 2360–2483)
