---
id: TASK-0962
title: Wire ShutdownService into AppModule shutdown hook chain
story: STORY-0319
status: done
type: infra
size: XS
---

## Description
Register `ShutdownService` as a provider in `AppModule` (or a `ShutdownModule` it imports) and verify `app.enableShutdownHooks()` is called in `main.ts` (owned by EPIC-01) so Nest fires `OnApplicationShutdown` on every provider including this one.

## Files to create / modify
- `apps/backend/src/app.module.ts` — modify (add provider)
- `apps/backend/src/main.ts` — modify (confirm `app.enableShutdownHooks()` is present)

## Implementation notes
- Quote §4.12: "The backend-architect's bootstrap calls `app.enableShutdownHooks()` which fires `OnApplicationShutdown` on every provider. `ShutdownService` registers explicitly with `BackgroundService` and `BlobStore` so the order is enforced regardless of Nest's internal provider order."

## Acceptance criteria
- [ ] `ShutdownService` is a provider in `AppModule`.
- [ ] `app.enableShutdownHooks()` is called in `main.ts`.
- [ ] SIGTERM during a running app triggers `ShutdownService.onApplicationShutdown` (asserted in [TEST-0327]).

## Test obligations
- Unit: covered by [TEST-0326]
- E2E: covered by [TEST-0327]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0961]

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6648–6658)
