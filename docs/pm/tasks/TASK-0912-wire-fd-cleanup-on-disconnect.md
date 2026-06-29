---
id: TASK-0912
title: Wire fd cleanup on client disconnect and stream error handling
story: STORY-0303
status: done
type: implementation
size: XS
---

## Description
Register a `res.once('close', ...)` listener that destroys the file read stream on client disconnect, so libuv releases the fd immediately. Also handle stream `'error'`: if headers are not yet sent, respond 500; otherwise destroy the socket since we cannot signal the client any other way.

## Files to create / modify
- `apps/backend/src/s3/object/get-object.handler.ts` — modify

## Implementation notes
- Verbatim cleanup per §4.2:
  ```ts
  const onClose = () => {
    if (!(stream as NodeJS.ReadableStream & { destroyed?: boolean }).destroyed) {
      (stream as NodeJS.ReadableStream & { destroy: (e?: Error) => void }).destroy();
    }
  };
  res.once('close', onClose);

  stream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      req.socket.destroy(err);
    }
  });

  stream.pipe(res);
  ```

## Acceptance criteria
- [ ] On `res` 'close' before stream end, the read stream is `destroy()`'d.
- [ ] Stream errors before headers sent → HTTP 500.
- [ ] Stream errors after headers sent → `req.socket.destroy(err)`.

## Test obligations
- Unit: covered by [TEST-0305]
- E2E: covered by [TEST-0306]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0911]

## References
- `docs/WHITEPAPER.md` §4.2 (lines 5604–5625)
