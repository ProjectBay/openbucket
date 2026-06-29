---
id: TASK-0957
title: Implement socket tracking via httpServer.on('connection')
story: STORY-0319
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/shutdown/shutdown.service.ts` with `ShutdownService` that, on construction, registers a `connection` listener on the HTTP server (via `HttpAdapterHost`) and tracks each accepted `Socket` in a `Set<Socket>`. Sockets are removed on their `close` event.

## Files to create / modify
- `apps/backend/src/common/shutdown/shutdown.service.ts` — new

## Implementation notes
- Verbatim per §4.12:
  ```ts
  private readonly activeSockets = new Set<Socket>();

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(BackgroundService) private readonly background: BackgroundService,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(MikroORM) private readonly orm: MikroORM,
  ) {
    const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
    httpServer?.on('connection', (socket) => {
      this.activeSockets.add(socket);
      socket.once('close', () => this.activeSockets.delete(socket));
    });
  }
  ```
- Constant: `const STREAM_DRAIN_DEADLINE_MS = 30_000;`.

## Acceptance criteria
- [ ] Service compiles with the constructor signature above.
- [ ] On each `connection`, the socket is added to `activeSockets` and removed on its `close`.

## Test obligations
- Unit: covered by [TEST-0326]
- E2E: covered by [TEST-0327]
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6571–6591)
