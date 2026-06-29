---
id: TASK-0004
title: Wire helmet and Express defaults in main.ts
story: STORY-0002
status: done
type: implementation
size: XS
---

## Description
Inside `bootstrap()`, disable `x-powered-by` and `etag` on the Express instance, set `trust proxy: 'loopback'`, and apply `helmet({ contentSecurityPolicy: false })` via `app.use(...)` per §1.2. CSP is intentionally disabled here because `SpaModule` (STORY-0013) configures CSP per-route.

## Files to create / modify
- `apps/openbucket-backend/src/main.ts` — modify

## Implementation notes
- Quote from §1.2 (lines 144–146):
  ```ts
  expressInstance.disable('x-powered-by');
  expressInstance.disable('etag');                  // we issue our own ETags for objects
  expressInstance.set('trust proxy', 'loopback');   // upstream TLS-terminating proxy
  ```
- Quote from §1.2 (line 162):
  ```ts
  app.use(helmet({ contentSecurityPolicy: false })); // CSP is configured per-route in SpaModule
  ```

## Acceptance criteria
- [ ] `expressInstance.disabled('x-powered-by') === true` post-config.
- [ ] `expressInstance.disabled('etag') === true` post-config.
- [ ] `expressInstance.get('trust proxy fn')` is loopback-only.
- [ ] `helmet` middleware is registered with `contentSecurityPolicy: false`.

## Test obligations
- Unit: covered by [TEST-0002]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0003]

## References
- `docs/WHITEPAPER.md` §1.2 (lines 141–162)
