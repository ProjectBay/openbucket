---
id: TEST-0701
title: CSP, safe object-response headers, transport timeouts, and CORS-oracle regression
covers: [STORY-0701, TASK-2110, TASK-2111, TASK-2112]
status: ready
level: e2e
---

## Goal
Prove the three `http-hardening` remediations hold: (a) raw S3 object reads are served as inert, non-rendering responses and the admin surface carries a real CSP ([TASK-2110], finding [2]); (b) the HTTP server enforces finite request/socket timeouts so a slow-body client cannot hold a socket open indefinitely ([TASK-2111], finding [5]); (c) the unauthenticated CORS preflight no longer leaks bucket existence ([TASK-2112], finding [14]). Includes the cross-cutting bypass sanity check from [STORY-0700].

## Setup
- Boot the standalone app (`apps/openbucket-backend`) against an in-memory SQLite DB and a temp `DATA_DIR` (per the repo's e2e data-dir + argon2 convention).
- Provision a root S3 credential; create a bucket `probe` and PUT an object `evil.html` with request header `Content-Type: text/html` and body `<script>document.title='xss'</script>`.
- For timeout cases, obtain the listening `http.Server` (via `app.getHttpServer()`) and a raw TCP client (`net.Socket`) to drip-feed bytes.
- For CORS cases, use `supertest` issuing `OPTIONS` with `Origin: https://x` and `Access-Control-Request-Method: GET`, no credentials.

## Cases

### TASK-2110 — CSP & safe object-response headers (finding [2])
1. Given `evil.html` stored as `text/html`, when `GET /probe/evil.html` with a valid SigV4 credential, then the response includes `Content-Disposition: attachment`, `Content-Security-Policy: default-src 'none'; sandbox`, and `X-Content-Type-Options: nosniff`; the body is served such that a browser would not execute it inline (attachment, or `Content-Type` overridden to a non-rendering type).
2. Given the same object, when `HEAD /probe/evil.html`, then the same neutralization headers are present (parity with `getObject`).
3. Given an admin bearer token, when `GET /api/admin/buckets/probe/objects/evil.html?content` (the inline preview branch), then the response carries the same neutralization headers as the raw S3 GET (the preview branch does not serve attacker `text/html` inline).
4. Given any admin SPA/API response (e.g. `GET /admin/` or an admin API 200), then a `Content-Security-Policy` header is present with `default-src 'self'` — i.e. CSP is no longer globally disabled.

### TASK-2111 — transport timeouts (finding [5])
5. Given the listening server, then `httpServer.requestTimeout` is a finite non-zero value (Node's 300000 default or configured), `httpServer.timeout` is finite, and `httpServer.maxConnections` is set — asserted directly on the server object.
6. Given a raw TCP socket that writes a complete request line + headers for `POST /api/admin/auth/login` and then sends no body bytes, when the configured `requestTimeout` elapses, then the server closes the socket (assert `'close'`/`ECONNRESET` within `requestTimeout + margin`) rather than holding it open — the unauthenticated RUDY/slow-body vector is closed.
7. Given a streaming PUT that continues to send body bytes within the stall window, then the request completes normally (the watchdog does not cut off a legitimate slow-but-progressing upload); given a PUT that sends headers then stalls with no bytes for N seconds, then the socket is destroyed by the stall watchdog.

### TASK-2112 — CORS enumeration oracle (finding [14])
8. Given no credentials, when `OPTIONS /does-not-exist` (with `Origin` + `Access-Control-Request-Method`), then the response is `403` with body `<Code>AccessDenied</Code>` — not `404 NoSuchBucket`.
9. Given an existing bucket `probe` with no CORS configuration, when the same anonymous `OPTIONS /probe`, then the response is byte-identical to case 8 (status + body) — not `404 NoSuchCORSConfiguration`.
10. Given an existing bucket whose CORS rules do not match the requested origin/method, when the same anonymous `OPTIONS`, then the response is byte-identical to cases 8 and 9. (The three non-matching outcomes are indistinguishable, so existence cannot be inferred.)
11. Given `probe` with a CORS rule matching `Origin: https://x` + method `GET`, when the anonymous `OPTIONS /probe`, then the response is `200` with the correct `Access-Control-Allow-Origin`/`Access-Control-Allow-Methods` headers (a genuine match still works).

### Cross-cutting bypass sanity (from STORY-0700, asserted here as a guardrail)
12. Given no bearer token, when `GET /api/Admin/backup` (mixed case) and `GET /api/admin/backup`, then both return `401` — the admin surface reached via the object-XSS oracle is not anonymously reachable (this confirms [TASK-2100] landed before this Story).

## Tooling
- Framework: jest + supertest for HTTP; `net.Socket` for the raw slow-body/stall cases; `@aws-sdk/client-s3` (or a SigV4 signer helper) for the credentialed PUT/GET.
- Runner: `nx e2e backend-e2e` (and `nx test nestjs --testPathPattern=cors.controller` / `object.service` for the unit-level header assertions).

## Pass criteria
- [ ] S3 `GET`/`HEAD` on a `text/html` object return `Content-Disposition: attachment` + `Content-Security-Policy: default-src 'none'; sandbox` + `nosniff` (cases 1–2).
- [ ] The admin `?content` preview carries the same neutralization headers, and admin responses carry `default-src 'self'` CSP (cases 3–4).
- [ ] `requestTimeout`/`timeout` are finite, `maxConnections` is set, and a headers-then-no-body login socket is closed within the deadline (cases 5–6).
- [ ] A stalled streaming PUT is destroyed while a progressing one completes (case 7).
- [ ] Anonymous `OPTIONS` on missing / no-CORS / no-match buckets are indistinguishable `403 AccessDenied`, and a genuine rule match still returns `200` + ACAO (cases 8–11).
- [ ] Mixed-case and lower-case unauthenticated admin paths return `401` (case 12).

## References
- White-box security audit, 2026-07-04 — findings [2], [5], [14].
- `libs/nestjs/src/lib/domain/objects/object.service.ts:432,521`; `apps/openbucket-backend/src/main.ts:42,93-97`; `libs/nestjs/src/lib/s3/cors/cors.controller.ts:58,62,71`; `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts:298-309`.
