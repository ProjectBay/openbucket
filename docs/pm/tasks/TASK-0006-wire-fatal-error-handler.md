---
id: TASK-0006
title: Wire top-level fatal-error handler
story: STORY-0002
status: done
type: implementation
size: XS
---

## Description
Append the top-level `bootstrap().catch(...)` block to `main.ts` per §1.2. On a fatal boot error (e.g. Zod schema rejection thrown out of `NestFactory.create`), Pino is not yet bound, so the catch logs via `console.error` and exits with code 1.

## Files to create / modify
- `apps/openbucket-backend/src/main.ts` — modify

## Implementation notes
- Quote §1.2 (lines 187–192) verbatim:
  ```ts
  bootstrap().catch((err) => {
    // Pino isn't bound yet if this throws during NestFactory.create; use stderr.
    // eslint-disable-next-line no-console
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
  ```

## Acceptance criteria
- [ ] A boot with an invalid `JWT_SECRET` (too short) logs `'Fatal bootstrap error:'` followed by the error to stderr and exits with code 1.
- [ ] The `bootstrap().catch(...)` pattern is the last top-level statement in `main.ts`.

## Test obligations
- Unit: covered by [TEST-0002]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0003]

## References
- `docs/WHITEPAPER.md` §1.2 (lines 187–193)
