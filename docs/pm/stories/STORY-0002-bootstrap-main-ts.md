---
id: STORY-0002
title: Implement bootstrap main.ts with Express adapter, Pino, timeouts
epic: EPIC-01
status: done
size: M
risk: medium
---

## User story
As a developer, I want a deterministic `main.ts` that builds the Nest app on the Express adapter, binds Pino as the logger, sets HTTP server timeouts for long-lived streams, and surfaces the SIGTERM coordinator, so that the backend boots predictably and a fatal config error exits with non-zero.

## Description
Realize the `apps/backend/src/main.ts` listed in §1.2 verbatim. The bootstrap disables `x-powered-by` and `etag` on Express, enables `trust proxy: 'loopback'`, creates the Nest app with `{ bodyParser: false, rawBody: false, bufferLogs: true }`, binds Pino via `app.useLogger(app.get(Logger))`, applies `helmet({ contentSecurityPolicy: false })`, tunes `requestTimeout=0`, `headersTimeout=60_000`, `keepAliveTimeout=65_000`, `maxRequestsPerSocket=0`, calls `app.enableShutdownHooks(['SIGINT', 'SIGTERM'])`, hands off to `installShutdownHandlers`, and listens on the configured port. A top-level catch logs to stderr and `process.exit(1)`.

## Acceptance criteria
- [ ] `nx serve openbucket-backend` boots and logs `OpenBucket listening on http://0.0.0.0:9000` (or configured port).
- [ ] `httpServer.requestTimeout === 0`, `headersTimeout === 60_000`, `keepAliveTimeout === 65_000`, `maxRequestsPerSocket === 0` (verified by a unit test or runtime assertion).
- [ ] `helmet` is applied with `contentSecurityPolicy: false`.
- [ ] A boot with a missing required env var prints the Zod issues to stderr and exits with code 1.
- [ ] Pino is the active logger (boot log line is JSON in production, pretty in development).

## Tasks
- [TASK-0003] Implement main.ts bootstrap function
- [TASK-0004] Wire helmet and Express defaults
- [TASK-0005] Apply HTTP server timeout constants for streaming
- [TASK-0006] Wire top-level fatal-error handler

## Test plan
- [TEST-0002] Bootstrap boot/exit semantics (unit)

## Milestone note
Closed at the M0→M1 boundary. The acceptance criteria are verified across:
the HTTP-timeout constants by `server-timeouts.spec.ts` (STORY-0309) and the
libuv pool by `uv-threadpool.spec.ts` (STORY-0310); boot + refuse-to-boot
(exit 1 on an invalid env) by the new spawned-process e2e
`openbucket-backend-e2e/src/bootstrap.e2e-spec.ts`. The originally-planned
`main.spec` unit (TEST-0002) was realized as that e2e instead — see TEST-0002.
Helmet/Express-defaults inspection (TEST-0002 case 3) is asserted only at the
code level; a dedicated assertion was judged low-value and is not tracked.

## Dependencies
- Blocks: [STORY-0012], [STORY-0015]
- Blocked by: [STORY-0001], [STORY-0003], [STORY-0011], [STORY-0014]

## References
- `docs/WHITEPAPER.md` §1.2 (lines 123–229)
- Interfaces consumed: `AppConfigService` (defined in STORY-0011), `configureBodyParsers` (STORY-0003), `installShutdownHandlers` (STORY-0015), `AppModule` (STORY-0004)
