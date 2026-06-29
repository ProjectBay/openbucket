---
id: STORY-0012
title: Add /api/admin/health and /api/admin/ready endpoints
epic: EPIC-01
status: done
size: S
risk: low
---

## User story
As an orchestrator (Docker / k8s / ECS), I want unauthenticated liveness and readiness probes at `/api/admin/health` and `/api/admin/ready`, so that I can route traffic only to a process that is actually ready to serve and drain it during SIGTERM.

## Description
Implement `apps/backend/src/admin/health/health.controller.ts` per §1.8 and `apps/backend/src/admin/health/health.module.ts`. The controller has two routes:
- `GET /api/admin/health` returns `{ status: 'ok', uptime: Math.floor(process.uptime()) }` with HTTP 200.
- `GET /api/admin/ready` returns `{ status: 'ready' }` only if (a) `ShutdownState.isShuttingDown` is false, (b) `orm.em.getConnection().execute('SELECT 1')` succeeds, (c) `blobs.canWrite()` returns true. On failure throws `ServiceUnavailableException({ status: 'draining' | 'db-unreachable' | 'storage-unwritable' })`.

Both routes are marked `@Public()` from `../../common/auth/public.decorator` (the decorator is owned by EPIC-05; this Story scaffolds the import path).

## Acceptance criteria
- [x] `GET /api/admin/health` returns 200 with `{ status: 'ok', uptime: <number> }`.
- [x] `GET /api/admin/ready` returns 200 `{ status: 'ready' }` when the M0
      sub-checks pass (drain state only — see Milestone note).
- [x] `GET /api/admin/ready` returns 503 with `{ status: 'draining' }` when `ShutdownState.isShuttingDown` is true.
- [ ] `GET /api/admin/ready` returns 503 with `{ status: 'db-unreachable' }` when the DB query throws. — **deferred to M1/EPIC-03** (no persistence layer in M0).
- [ ] `GET /api/admin/ready` returns 503 with `{ status: 'storage-unwritable' }` when `BlobStoreHealth.canWrite()` resolves false. — **deferred to M1/EPIC-03** (no blob store in M0).
- [x] Both routes carry the `@Public()` marker so the admin JWT guard (EPIC-05) skips them.

## Tasks
- [TASK-0032] Implement HealthController with health endpoint
- [TASK-0033] Implement readiness endpoint with three sub-checks
- [TASK-0034] Wire HealthModule and register in AdminModule

## Test plan
- [TEST-0013] Health and readiness endpoints (e2e)

## Milestone note
Closed at the M0→M1 boundary with a documented **M0 reduction** (WHITEPAPER
§1.8): `/ready` checks only liveness + drain state. The two remaining sub-checks
— SQLite reachability (`orm.em` `SELECT 1` → `db-unreachable`) and blob-store
writability (`BlobStoreHealth.canWrite()` → `storage-unwritable`) — depend on the
EPIC-03 persistence layer and are wired in **M1**. `health.controller.ts` carries
the matching `TODO(M1/EPIC-03)`. The deferred readiness branches and their
failure-mode tests (TEST-0013 cases 3–5) land with that work.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0002], [STORY-0014]

## References
- `docs/WHITEPAPER.md` §1.8 (lines 818–871)
- Interfaces consumed: `ShutdownState` (STORY-0014), `BlobStoreHealth` (owned by EPIC-03), `MikroORM` (owned by EPIC-03), `@Public()` (owned by EPIC-05)
- Interfaces produced: `HealthController`, `HealthModule` (mounted under AdminModule, owned by EPIC-05)
