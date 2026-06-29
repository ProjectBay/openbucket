---
id: TEST-0017
title: SIGTERM drain end-to-end
covers: [STORY-0015]
status: done
level: e2e
---

## Goal
Verify a SIGTERM during a long-running in-flight request drains cleanly and exits 0, and a SIGTERM exceeding `SHUTDOWN_DRAIN_MS` exits 1.

## Setup
- Spawn the built backend as a child process (via `child_process.spawn`) with a small `SHUTDOWN_DRAIN_MS` (e.g. 2_000 ms) and a long one (e.g. 30_000 ms) per case. Use a test-only route that holds a request open for a controllable duration.

## Cases
1. Given `SHUTDOWN_DRAIN_MS=30_000`, when a 5 s slow request is in flight and SIGTERM is sent at t=1 s, then:
   - `GET /api/admin/ready` starts returning 503 `{ status: 'draining' }` immediately after SIGTERM.
   - The slow request completes successfully at t=5 s.
   - The process exits with code 0 after the in-flight response is sent.
2. Given `SHUTDOWN_DRAIN_MS=2_000`, when a 10 s slow request is in flight and SIGTERM is sent at t=1 s, then:
   - The process emits the `Drain deadline (2000ms) elapsed with 1 in-flight requests; closing anyway.` log line.
   - The process exits with code 1 within ~2 s of SIGTERM.
3. Given SIGINT (Ctrl-C) instead of SIGTERM with no in-flight traffic, then the process exits 0 cleanly.
4. Given two SIGTERMs in rapid succession, then the second one forces `process.exit(1)`.

## Tooling
- Framework: jest + `child_process.spawn` + supertest (against the live child)
- Runner: `nx e2e openbucket-backend-e2e --testPathPattern=shutdown.e2e.spec`

## Pass criteria
- [x] All four cases pass (in Linux CI).
- [x] Case 1 process exit code is 0.
- [x] Case 2 process exit code is 1.

## Platform note
Realized in `openbucket-backend-e2e/src/shutdown.e2e-spec.ts` against the built
backend, using a gated `OPENBUCKET_TEST_MODE=1` `/api/admin/_test/slow` route to
hold a request open. The suite is **POSIX-only** (`describe.skip` on win32):
`child.kill('SIGTERM')` on Windows maps to TerminateProcess, which hard-kills
without running the handler, so a graceful-drain assertion is meaningless there.
The coordinator logic is covered on every platform by the TEST-0016 unit suite;
these four cases run for real in Linux CI and are skipped on Windows dev.

## References
- `docs/WHITEPAPER.md` §1.10 (lines 920–1051)
