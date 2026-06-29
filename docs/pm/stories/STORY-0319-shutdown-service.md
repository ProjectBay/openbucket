---
id: STORY-0319
title: ShutdownService 5-step ordering with stream drain deadline
epic: EPIC-04
status: done
size: M
risk: high
---

## User story
As an operator, I want SIGTERM to drain in-flight streams within 30 s, cancel scheduler ticks, flush BlobStore, and checkpoint SQLite in a deterministic order, so that the container exits cleanly without losing committed writes.

## Description
Implement `apps/backend/src/common/shutdown/shutdown.service.ts`. The service implements `OnApplicationShutdown`. On `connection` it tracks each accepted socket in a `Set<Socket>`. On shutdown it performs the five steps in order: (1) `httpServer.close()` and `socket.end()` each tracked socket that is `writable && !writableNeedDrain`; (2) drain remaining sockets up to `STREAM_DRAIN_DEADLINE_MS = 30_000`, polling every 100 ms, then `socket.destroy()` on any survivors; (3) call `background.onApplicationShutdown()` directly to cancel ticks and await the in-flight one (the BackgroundService's `shuttingDown` guard makes this re-entrant-safe); (4) call `blobs.close?.()`; (5) `orm.close(true)` (final boolean triggers WAL checkpoint). Each step emits a status log line. This Story consumes the `ShutdownState` mechanism scaffolded by [EPIC-01] (e.g. accepting the SIGTERM signal handler and `app.enableShutdownHooks()`).

## Acceptance criteria
- [x] `ShutdownService` implements `OnApplicationShutdown`.
- [x] An `httpServer.on('connection', ...)` listener tracks accepted sockets and removes them on `close`.
- [x] Step 1: `httpServer.close()` is awaited and tracked sockets that are `writable && !writableNeedDrain` are `end()`'d.
- [x] Step 2: while `activeSockets.size > 0`, the loop polls every 100 ms and after `STREAM_DRAIN_DEADLINE_MS = 30_000` ms calls `socket.destroy()` on each, logging `Drain deadline reached with N sockets — destroying`.
- [x] Step 3: calls `background.onApplicationShutdown()` explicitly.
- [x] Step 4: calls `blobs.close?.()` (optional-chain).
- [x] Step 5: calls `orm.close(true)`.
- [x] Each step emits a `Logger.log` line per §4.12.
- [x] `nx test backend --testPathPattern=shutdown.service.spec.ts` passes.

## Tasks
- [TASK-0957] Implement socket tracking via `httpServer.on('connection')`
- [TASK-0958] Implement step 1 (stop accepting + end idle sockets)
- [TASK-0959] Implement step 2 stream drain with 30s deadline and forced destroy
- [TASK-0960] Implement step 3 (explicit BackgroundService.onApplicationShutdown)
- [TASK-0961] Implement steps 4 and 5 (BlobStore.close, orm.close(true))
- [TASK-0962] Wire ShutdownService into AppModule shutdown hook chain

## Test plan
- [TEST-0326] ShutdownService 5-step ordering unit tests
- [TEST-0327] SIGTERM drain e2e via supertest

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0313], [EPIC-03] (`BlobStore.close`, `MikroORM.close`)

## Milestone note
Reclassified from M0 to **M3** during M0 implementation. This §4.12 service is
the complete shutdown (socket tracking, 5-step ordering, BlobStore flush, WAL
checkpoint) and cannot exist until STORY-0313 (BackgroundService) and the
EPIC-03 persistence layer land. M0's shutdown behaviour is provided by the
§1.10 coordinator (STORY-0015); STORY-0319 supersedes it in M3.

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6547–6658)
- Interfaces consumed: `HttpAdapterHost` (defined in [EPIC-01]), `BackgroundService` (defined in [STORY-0313]), `BlobStore.close` (defined in [EPIC-03]), `MikroORM.close` (defined in [EPIC-03]), `ShutdownState` (defined in [EPIC-01])
- Interfaces produced: `ShutdownService`
