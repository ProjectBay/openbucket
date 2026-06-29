---
id: TASK-0005
title: Apply HTTP server timeout constants for streaming
story: STORY-0002
status: done
type: implementation
size: XS
---

## Description
After Nest has built the app and before `listen()`, fetch the underlying `http.Server` via `app.getHttpServer()` and apply the four timeout constants documented in §1.2. These tune the server for long-lived S3 multipart uploads where per-request deadlines are inappropriate.

## Files to create / modify
- `apps/openbucket-backend/src/main.ts` — modify

## Implementation notes
- Quote from §1.2 (lines 171–175) verbatim:
  ```ts
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 0;                // disable per-request timeout; streaming sets its own
  httpServer.headersTimeout = 60_000;           // 60s to send full request headers
  httpServer.keepAliveTimeout = 65_000;         // > headersTimeout so we stay friendly with HTTP/1.1
  httpServer.maxRequestsPerSocket = 0;
  ```
- The `keepAliveTimeout > headersTimeout` invariant is load-bearing — do not invert.

## Acceptance criteria
- [ ] `httpServer.requestTimeout === 0`.
- [ ] `httpServer.headersTimeout === 60_000`.
- [ ] `httpServer.keepAliveTimeout === 65_000`.
- [ ] `httpServer.maxRequestsPerSocket === 0`.

## Test obligations
- Unit: covered by [TEST-0002]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0003]

## References
- `docs/WHITEPAPER.md` §1.2 (lines 170–175)
