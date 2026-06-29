---
id: TASK-0042
title: Implement drain race against deadline
story: STORY-0015
status: done
type: implementation
size: S
---

## Description
Implement the drain race per §1.10: after `server.close(...)`, race `state.whenDrained()` against an unref-ed timeout. Log either `'All in-flight requests completed.'` on a clean drain or `'Drain deadline (${drainTimeoutMs}ms) elapsed with ${state.inFlight} in-flight requests; closing anyway.'` on timeout.

## Files to create / modify
- `apps/openbucket-backend/src/bootstrap/shutdown.ts` — modify

## Implementation notes
- Quote §1.10 (lines 1014–1032) verbatim:
  ```ts
  const server = app.getHttpServer() as Server;
  server.close((err) => {
    if (err) logger.error({ err }, 'HTTP server close error.');
  });

  const drain = state.whenDrained();
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), drainTimeoutMs).unref(),
  );
  const outcome = await Promise.race([drain.then(() => 'drained' as const), timeout]);

  if (outcome === 'timeout') {
    logger.warn(
      `Drain deadline (${drainTimeoutMs}ms) elapsed with ${state.inFlight} in-flight requests; closing anyway.`,
    );
  } else {
    logger.log('All in-flight requests completed.');
  }
  ```
- `setTimeout(...).unref()` ensures the timer does not by itself keep the event loop alive.

## Acceptance criteria
- [ ] `server.close(...)` is called with an error-logging callback before the drain race.
- [ ] The timeout uses `setTimeout(...).unref()`.
- [ ] `outcome` resolves to `'drained' | 'timeout'`.
- [ ] Log lines match the documented strings verbatim.

## Test obligations
- Unit: covered by [TEST-0016]
- E2E: covered by [TEST-0017]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0040], [TASK-0041]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 1014–1032)
