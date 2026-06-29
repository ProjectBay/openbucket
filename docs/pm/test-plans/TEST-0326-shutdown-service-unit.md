---
id: TEST-0326
title: ShutdownService 5-step ordering unit tests
covers: [STORY-0319, TASK-0957, TASK-0958, TASK-0959, TASK-0960, TASK-0961, TASK-0962]
status: done
level: unit
---

## Goal
Verify the 5-step shutdown ordering: stop accepting → drain (30s deadline) → cancel background → BlobStore.close → ORM.close(true).

## Setup
- Mock `HttpAdapterHost`, `BackgroundService`, `BlobStore`, `MikroORM`.
- Mock `httpServer` with a controllable `close(cb)` and a `connection` event emitter for socket tracking.

## Cases
1. Given a tracked socket emits `'connection'`, then it is added to `activeSockets`; emitting `'close'` removes it.
2. On shutdown, `httpServer.close()` is awaited and idle writable sockets are `.end()`'d.
3. While `activeSockets.size > 0`, the drain loop polls at 100 ms; sockets that close are removed.
4. Given a socket that never closes, after 30s (fake timers), the runner logs `Drain deadline reached with N sockets — destroying` and calls `socket.destroy()`.
5. After drain, `background.onApplicationShutdown()` is awaited.
6. After background shutdown, `blobs.close?.()` is awaited (optional-chain; absent close is a no-op).
7. Finally, `orm.close(true)` is awaited with the `true` argument.
8. The five log lines fire in order: `HTTP server stopped accepting new connections` → `Stream drain complete in <ms>ms` → `Background ticks cancelled and drained` → `BlobStore closed` → `MikroORM closed` → `Shutdown complete`.
9. Re-entrant call (Nest also fires `OnApplicationShutdown`) does not double-run — assertion that `background.onApplicationShutdown` is invoked once from `ShutdownService` regardless of Nest's chain.

## Tooling
- Framework: jest with fake timers
- Runner: `nx test backend --testPathPattern=shutdown.service.spec.ts`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6547–6658)
