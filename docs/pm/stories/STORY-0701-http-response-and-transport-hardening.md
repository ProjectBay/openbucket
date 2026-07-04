---
id: STORY-0701
title: HTTP response & transport hardening
epic: EPIC-08
status: ready
size: M
risk: high
---

## User story
As an operator exposing `@openbucket/nestjs` to the hostile internet, I want the HTTP layer to emit a real Content-Security-Policy, serve S3 object bodies as inert non-rendering downloads, enforce finite request/socket timeouts, and stop leaking bucket existence over unauthenticated CORS preflights, so that a malicious tenant cannot turn a stored object into admin-token-stealing XSS, exhaust my sockets with a slow-body flood, or enumerate my bucket namespace with no credentials.

## Description
This Story closes the three `http-hardening` audit findings against the standalone server and the S3 read path. It re-enables a restrictive CSP for the admin surface and neutralizes active content on raw S3 `GET`/`HEAD` responses ([2], stored XSS → admin-token theft via the `/refresh` oracle); it replaces the blanket `requestTimeout = 0` / `timeout = 0` disablement with bounded timeouts plus a streaming-upload stall watchdog and a connection ceiling ([5], slowloris/RUDY); and it collapses the CORS preflight not-found / no-CORS branches into one opaque `403` so bucket existence is no longer observable ([14], enumeration oracle). Each fix ships with a regression test under [TEST-0701]. It does **not** re-architect origin isolation of the S3 data plane from the admin control plane — that structural fix is tracked separately; this Story hardens the single-origin deployment in place.

## Acceptance criteria
- [ ] A raw S3 `GET`/`HEAD` on an object stored with `Content-Type: text/html` returns `Content-Disposition: attachment`, `Content-Security-Policy: default-src 'none'; sandbox`, and `X-Content-Type-Options: nosniff`; a browser does not render/execute the body inline.
- [ ] The admin object `?content` preview branch (`objects-admin.controller.ts`) applies the same inline-neutralization headers as the raw S3 GET.
- [ ] The admin SPA / API responses carry a restrictive `Content-Security-Policy` (`default-src 'self'`), i.e. `contentSecurityPolicy` is no longer globally `false` in `main.ts`.
- [ ] `httpServer.requestTimeout` is a finite value (Node's 300000 default or a configured value), not `0`; a connection that sends complete headers then trickles the body is destroyed within the configured deadline.
- [ ] A slow-body `POST /api/admin/auth/login` (headers sent, body drip-fed) is terminated by the server rather than held open indefinitely.
- [ ] `httpServer.maxConnections` is set (or a documented upstream proxy limit is asserted), and long legitimate streaming PUTs are governed by a per-request stall/throughput watchdog rather than a disabled timeout.
- [ ] An unauthenticated `OPTIONS /:bucket` preflight returns an identical `403 AccessDenied` response for a non-existent bucket, an existing bucket with no CORS config, and an existing bucket whose rules do not match — existence is not distinguishable on the wire; only a genuine rule match yields `200` + ACAO headers.

## Tasks
- [TASK-2110] Enable a Content-Security-Policy and force safe object-response headers on S3 GET/HEAD
- [TASK-2111] Restore finite per-request and socket timeouts with a streaming stall watchdog
- [TASK-2112] Collapse the CORS preflight branches to remove the bucket-enumeration oracle

## Test plan
- [TEST-0701] CSP, safe object-response headers, transport timeouts, and CORS-oracle regression

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0700] — specifically its P0 [TASK-2100] (case-sensitivity admin-auth bypass, CWE-178) must land first: finding [2]'s XSS payoff drives the same-origin `/api/admin/auth/refresh` token oracle, and the unauthenticated admin bypass is the higher-severity gate on the same admin surface. Ship the [STORY-0700] patch, then this Story.

## References
- White-box security audit, 2026-07-04 — findings [2] (HIGH, CWE-79 stored XSS), [5] (MEDIUM, CWE-400 slowloris/RUDY), [14] (LOW, CWE-203 observable discrepancy).
- `apps/openbucket-backend/src/main.ts:42` — `helmet({ contentSecurityPolicy: false })`; lines 93–97 — disabled timeouts.
- `libs/nestjs/src/lib/domain/objects/object.service.ts:432` (`getObject`), `:521` (`headObject`) — Content-Type set verbatim, no Content-Disposition/CSP.
- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts:298-309` — `?content` preview reuses the raw streamer.
- `apps/openbucket-backend/src/bootstrap/body-parser.ts` — pre-guard body parsing on `/api/admin`.
- `libs/nestjs/src/lib/s3/cors/cors.controller.ts:58,62,71` — the three distinguishable preflight outcomes.
- Interfaces produced: hardened `getObject`/`headObject` response headers; consumed by admin `?content` preview and [TEST-0701].
