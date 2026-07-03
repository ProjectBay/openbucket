---
id: TASK-2111
title: Restore finite per-request and socket timeouts with a streaming stall watchdog
story: STORY-0701
status: ready
type: implementation
size: S
---

## Description
Remediates audit finding [5] (MEDIUM, CWE-400 slowloris/RUDY). The standalone server sets `httpServer.requestTimeout = 0` and `httpServer.timeout = 0`, removing both the per-request completion deadline and the socket inactivity timeout, and sets no `maxConnections` cap. A client that sends complete headers within the 60s `headersTimeout` and then trickles the body a few bytes at a time holds a socket open forever. The cleanest unauthenticated vector is a slow-body `POST /api/admin/auth/login`: `body-parser.ts` reads the body to completion (relying on `server.requestTimeout`, which is `0`) before the throttler/auth guards run. This task restores bounded timeouts while preserving legitimate long streaming uploads via a stall watchdog rather than a blanket disable.

## Files to create / modify
- `apps/openbucket-backend/src/main.ts` — modify. Replace the blanket `requestTimeout = 0` (line 93) and `timeout = 0` (line 96) with finite values, and add a `maxConnections` ceiling (lines 93–97).
- `libs/nestjs/src/lib/s3/object/put-object.interceptor.ts` — modify (or an equivalent streaming hook). Add a per-request stall/throughput watchdog (`req.setTimeout(...)` or a timer reset on each `'data'` event) so a streaming PUT that stops receiving bytes for N seconds is destroyed, replacing the "disable all timeouts so streams are never cut off" rationale.

## Implementation notes
- CWE-400 (Uncontrolled Resource Consumption — Slowloris/RUDY).
- Vulnerable code, `apps/openbucket-backend/src/main.ts`:
  ```ts
  httpServer.requestTimeout = 0;   // line 93 — disables per-request completion deadline
  httpServer.headersTimeout = 60_000;  // line 94 — bounds header phase only
  httpServer.keepAliveTimeout = 75_000; // line 95
  httpServer.timeout = 0;          // line 96 — disables socket inactivity timeout
  httpServer.maxRequestsPerSocket = 0; // line 97 — no per-socket request cap, no maxConnections
  ```
  Only `headersTimeout` survives, and it bounds the header phase, not the body phase. Node's default `requestTimeout` (300000 ms) exists specifically to stop this attack and has been explicitly zeroed.
- Unauthenticated vector confirmed by the audit: `apps/openbucket-backend/src/bootstrap/body-parser.ts` mounts `json()`/`urlencoded()` on `/api/admin` as Express middleware that runs **before** the Nest guards; `@Public() POST /api/admin/auth/login` therefore stalls in the body parser indefinitely on a drip-fed body, holding a socket with no credentials. The `@Throttle` 5/60s cap does not help because a stalled request never completes and is never counted.
- Fix, per the audit fix note:
  1. Restore a bounded `httpServer.requestTimeout` — Node's `300000` default (or a configured value) — so non-streaming routes, especially the `/api/admin` body-parser paths, get a hard completion deadline. This alone closes the unauthenticated login RUDY.
  2. For legitimate long streaming PUTs, replace the "disable all timeouts" approach with a per-request stall/throughput watchdog on the S3 PUT path: `req.setTimeout()` or a manual timer reset on each `'data'` event, destroying a socket that receives no bytes for N seconds (and/or enforcing a minimum bytes/sec) instead of allowing an unbounded idle body. Update the inline comment `// disable per-request timeout; streaming sets its own` to reflect that streaming now actually sets a stall timeout.
  3. Set `httpServer.maxConnections` (and keep a socket inactivity `httpServer.timeout` finite), or document and assert reliance on the upstream reverse proxy (the app sets `trust proxy 'loopback'`) for slow-client protection.
- Keep `headersTimeout = 60_000` and `keepAliveTimeout = 75_000` (they are correct); the change is that the body phase is no longer unbounded.

## Acceptance criteria
- [ ] After `app.listen(...)`, `httpServer.requestTimeout` is a finite non-zero value (default 300000 or configured), not `0`.
- [ ] `httpServer.timeout` is finite (socket inactivity bounded) and `httpServer.maxConnections` is set.
- [ ] A connection that sends complete request headers then no body bytes is destroyed within the configured deadline (verified by a spec that opens a socket, writes headers, and asserts closure).
- [ ] A slow-body `POST /api/admin/auth/login` is terminated by the server rather than held open indefinitely.
- [ ] A legitimate streaming PUT that keeps sending bytes is not cut off; a PUT that stalls (no bytes for N seconds) is destroyed by the watchdog.
- [ ] `nx test backend --testPathPattern=main.spec.ts` (or the bootstrap spec) asserts the finite timeout/`maxConnections` values.

## Test obligations
- Unit: covered by [TEST-0701] (assert `requestTimeout`/`timeout`/`maxConnections` values on the listening server).
- E2E: covered by [TEST-0701] (headers-then-no-body socket closed within the deadline; slow-body login terminated).
- Conformance: N/A — pure transport hardening.

## Dependencies
- Blocked by: _none_ (independent of the other STORY-0701 tasks).

## References
- White-box security audit, 2026-07-04 — finding [5] (MEDIUM, CWE-400).
- `apps/openbucket-backend/src/main.ts:93-97`; `apps/openbucket-backend/src/bootstrap/body-parser.ts`; `libs/nestjs/src/lib/s3/object/put-object.interceptor.ts`.
- Prior context: [STORY-0309] / [TASK-0925] set these timeouts to `0` for multi-GB streaming; this task supersedes that decision with a bounded + watchdog model.
