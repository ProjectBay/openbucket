---
id: TASK-0010
title: Apply RequestIdMiddleware and RequestClassifierMiddleware globally
story: STORY-0004
status: done
type: implementation
size: XS
---

## Description
Implement `AppModule.configure(consumer)` per §1.3. Apply `RequestIdMiddleware` then `RequestClassifierMiddleware` to `{ path: '*', method: RequestMethod.ALL }`. Order matters: the request-id middleware must run first because the classifier reads `req.openbucket.requestId` indirectly via the logger.

## Files to create / modify
- `apps/openbucket-backend/src/app.module.ts` — modify

## Implementation notes
- Quote §1.3 (lines 329–337):
  ```ts
  export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer
        .apply(RequestIdMiddleware, RequestClassifierMiddleware)
        .forRoutes({ path: '*', method: RequestMethod.ALL });
    }
  }
  ```

## Acceptance criteria
- [ ] `AppModule` implements `NestModule`.
- [ ] `configure` calls `consumer.apply(RequestIdMiddleware, RequestClassifierMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL })`.
- [ ] At runtime, `req.openbucket.requestId` is set before any controller observes the request.

## Test obligations
- Unit: covered by [TEST-0004]
- E2E: N/A — exercised by STORY-0007 e2e
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0008], [TASK-0013], [TASK-0015]

## References
- `docs/WHITEPAPER.md` §1.3 (lines 329–337)
