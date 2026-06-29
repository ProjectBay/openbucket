---
id: TASK-0021
title: Register ZodValidationPipe and ShutdownTrackerInterceptor globally
story: STORY-0008
status: done
type: implementation
size: XS
---

## Description
Add the global pipe and interceptor providers to `common.module.ts` per §1.6: `{ provide: APP_PIPE, useClass: ZodValidationPipe }` and `{ provide: APP_INTERCEPTOR, useClass: ShutdownTrackerInterceptor }`.

## Files to create / modify
- `apps/openbucket-backend/src/common/common.module.ts` — modify

## Implementation notes
- Quote §1.6 (lines 549–559):
  ```ts
  // Pipes
  { provide: APP_PIPE, useClass: ZodValidationPipe },
  ...
  // Interceptors
  { provide: APP_INTERCEPTOR, useClass: ShutdownTrackerInterceptor },
  ```

## Acceptance criteria
- [ ] `APP_PIPE` provider uses `ZodValidationPipe`.
- [ ] `APP_INTERCEPTOR` provider uses `ShutdownTrackerInterceptor`.
- [ ] A unit test confirms a controller body rejected by a Zod schema reaches `AdminExceptionFilter` with `ZodValidationException`.

## Test obligations
- Unit: covered by [TEST-0009]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0019], [TASK-0027], [TASK-0039]

## References
- `docs/WHITEPAPER.md` §1.6 (lines 549–559)
