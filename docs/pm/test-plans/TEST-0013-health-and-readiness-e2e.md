---
id: TEST-0013
title: /api/admin/health and /api/admin/ready end-to-end
covers: [STORY-0012, TASK-0032, TASK-0033, TASK-0034]
status: done
level: e2e
---

## Goal
Verify both probes serve unauthenticated, return the documented shapes on the happy path, and surface the three readiness failure modes.

## Setup
- Boot Nest via `Test.createTestingModule` with a real `CommonModule`, stub `MikroORM` (returning a controllable `getConnection()`), stub `BlobStoreHealth.canWrite`, and the real `ShutdownState`. Use supertest against `app.getHttpServer()`.

## Cases
1. Given a fresh boot, when `GET /api/admin/health`, then status 200 with body `{ status: 'ok', uptime: <int> }` (uptime ≥ 0).
2. Given a fresh boot, no shutdown, DB ok, blob ok, when `GET /api/admin/ready`, then status 200 `{ status: 'ready' }`.
3. Given `state.beginShutdown()` was called, when `GET /api/admin/ready`, then status 503 with body `{ status: 'draining', ..., requestId }`.
4. Given the DB stub throws on `execute('SELECT 1')`, when `GET /api/admin/ready`, then status 503 `{ status: 'db-unreachable' }`.
5. Given `BlobStoreHealth.canWrite` resolves false, when `GET /api/admin/ready`, then status 503 `{ status: 'storage-unwritable' }`.
6. Given no Authorization header is present, when either route is called, then no auth challenge occurs (both are `@Public()`).
7. Given any of the above, then the response includes `X-Request-Id` and `X-Amz-Request-Id` headers.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e openbucket-backend-e2e --testPathPattern=health.e2e.spec`

## Pass criteria
- [x] Cases 1, 2, 7 pass via the spawned-process e2e (health 200 shape;
      ready 200 `{ status: 'ready' }`; `X-Request-Id`/`X-Amz-Request-Id` present).
- [x] Case 3 (draining→503) covered by the shutdown e2e (TEST-0017, POSIX) and
      the `ShutdownState` unit suite.
- [ ] Cases 4 & 5 (`db-unreachable`, `storage-unwritable`) — **deferred to
      M1/EPIC-03**; no persistence/blob layer exists in M0 (see STORY-0012
      Milestone note).
- [ ] Failure bodies include `requestId` — verified once the M1 failure branches
      land.

## Realization note
Realized as a spawned-process **e2e** (`openbucket-backend-e2e/src/health.e2e-spec.ts`)
against the built backend rather than `Test.createTestingModule` with stubbed
`MikroORM`/`BlobStoreHealth`, because those dependencies do not exist in M0. The
stub-driven failure-mode cases (3–5 as originally written) move to M1 with the
real persistence layer.

## References
- `docs/WHITEPAPER.md` §1.8 (lines 818–872)
