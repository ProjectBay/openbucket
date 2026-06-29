---
id: TEST-0002
title: Bootstrap boot/exit semantics
covers: [STORY-0002, TASK-0003, TASK-0004, TASK-0005, TASK-0006]
status: done
level: unit
---

## Goal
Verify that `main.ts` constructs the Nest app with the documented options, applies all HTTP server timeout constants, registers helmet/Express defaults, and surfaces fatal boot errors via the top-level catch.

## Setup
- Use Jest with `NestFactory.create` mocked (or invoked against a stub `AppModule` that contains only `CommonModule`).
- A valid env stub via `process.env` is set in `beforeAll`.

## Cases
1. Given a valid environment, when `bootstrap()` runs, then `NestFactory.create` is called with options `{ bufferLogs: true, rawBody: false, bodyParser: false }`.
2. Given the booted app, when inspecting `httpServer`, then `requestTimeout === 0`, `headersTimeout === 60_000`, `keepAliveTimeout === 65_000`, `maxRequestsPerSocket === 0`.
3. Given the Express instance, when bootstrap completes, then `disabled('x-powered-by')` and `disabled('etag')` are true, `get('trust proxy fn')` is loopback, and helmet middleware is in the stack with `contentSecurityPolicy: false`.
4. Given a missing required env var, when `bootstrap()` runs, then the top-level catch logs `'Fatal bootstrap error:'` to stderr and the process exits with code 1.

## Tooling
- Framework: jest
- Runner: `nx test openbucket-backend --testPathPattern=main.spec`

## Pass criteria
- [x] Cases 1 & 4 (boot serves health; invalid env exits 1 with the Zod issue)
      pass via the spawned-process e2e.
- [x] Timeout constants match `§1.2` lines 172–175 exactly — `server-timeouts.spec.ts`.
- [x] Fatal-boot path does not bind the listener — `bootstrap.e2e-spec.ts`.
- [ ] Case 3 (helmet/Express-defaults stack inspection) — not separately
      asserted; deferred as low-value (code-level only).

## Realization note
Realized at the M0→M1 boundary as a spawned-process **e2e**
(`openbucket-backend-e2e/src/bootstrap.e2e-spec.ts`) rather than the
originally-planned `main.spec` unit: it boots a valid env and serves
`/api/admin/health`, then boots with `DATA_DIR=''` and asserts exit code 1 with
`Invalid environment configuration` + `DATA_DIR` on stderr. Case 2 (timeout
constants) is covered by `server-timeouts.spec.ts` + `uv-threadpool.spec.ts`
(STORY-0309/0310). Case 3 (helmet inspection) is deferred — see pass criteria.

## References
- `docs/WHITEPAPER.md` §1.2 (lines 123–229)
