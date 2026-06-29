---
id: TASK-0040
title: Implement installShutdownHandlers entry point
story: STORY-0015
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/bootstrap/shutdown.ts` exposing `installShutdownHandlers(app: INestApplication, _opts: ShutdownOptions): void`. Read `drainTimeoutMs` from `AppConfigService.shutdownDrainMs` and register the inner `shutdown(signal)` async function on both `SIGTERM` and `SIGINT`. Define `interface ShutdownOptions { drainTimeoutMs: number }` for the public signature even though the value is sourced from config.

## Files to create / modify
- `apps/openbucket-backend/src/bootstrap/shutdown.ts` — new

## Implementation notes
- Quote §1.10 (lines 995–1046) signature:
  ```ts
  interface ShutdownOptions { drainTimeoutMs: number }

  export function installShutdownHandlers(app: INestApplication, _opts: ShutdownOptions): void {
    const logger = new Logger('Shutdown');
    const state = app.get(ShutdownState);
    const config = app.get(AppConfigService);
    const drainTimeoutMs = config.shutdownDrainMs;
    let shuttingDown = false;
    async function shutdown(signal: NodeJS.Signals): Promise<void> { ... }
    process.on('SIGTERM', (s) => void shutdown(s));
    process.on('SIGINT', (s) => void shutdown(s));
  }
  ```
- §1.10 line 1001 confirms `_opts` is intentionally unused (the value is config-driven).

## Acceptance criteria
- [ ] Public signature is `(app: INestApplication, _opts: ShutdownOptions): void`.
- [ ] `drainTimeoutMs` is read from `AppConfigService.shutdownDrainMs`.
- [ ] Both `SIGTERM` and `SIGINT` listeners are registered.
- [ ] The inner `shutdown` function name is `shutdown`.

## Test obligations
- Unit: covered by [TEST-0016]
- E2E: covered by [TEST-0017]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001], [TASK-0030], [TASK-0037]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 986–1046)
