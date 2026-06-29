---
id: TASK-0958
title: Implement step 1 — stop accepting and end idle sockets
story: STORY-0319
status: done
type: implementation
size: XS
---

## Description
In `onApplicationShutdown`, call `httpServer.close()` and await the resulting `Promise<void>`. While the close is pending, iterate `activeSockets` and call `socket.end()` on each that is `writable && !writableNeedDrain` — Node 22 does not close keep-alive idle sockets via `close()` alone.

## Files to create / modify
- `apps/backend/src/common/shutdown/shutdown.service.ts` — modify

## Implementation notes
- Verbatim per §4.12:
  ```ts
  const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
  await new Promise<void>((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
    for (const sock of this.activeSockets) {
      if (sock.writable && !sock.writableNeedDrain) {
        sock.end();
      }
    }
  });
  this.log.log('HTTP server stopped accepting new connections');
  ```

## Acceptance criteria
- [ ] `httpServer.close()` is awaited via the `Promise<void>` wrapper.
- [ ] Idle keep-alive sockets are `.end()`'d during the close window.
- [ ] Log `HTTP server stopped accepting new connections` is emitted.

## Test obligations
- Unit: covered by [TEST-0326]
- E2E: covered by [TEST-0327]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0957]

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6596–6609)
