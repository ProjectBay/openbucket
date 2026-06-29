---
id: TASK-0019
title: Implement CommonModule providers and exports
story: STORY-0008
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/common/common.module.ts` per §1.6. Mark `@Global()`, import the local `config.module.ts` (aliased `AppConfigInternalModule`), provide the two middlewares and the shutdown tracker interceptor as ordinary providers, and re-export the config module plus both middlewares.

## Files to create / modify
- `apps/openbucket-backend/src/common/common.module.ts` — new

## Implementation notes
- Quote §1.6 (lines 528–567):
  ```ts
  import { Module, Global } from '@nestjs/common';
  import { APP_FILTER, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
  import { ZodValidationPipe } from 'nestjs-zod';

  import { ConfigModule as AppConfigInternalModule } from './config/config.module';
  import { S3ExceptionFilter } from './filters/s3-exception.filter';
  import { AdminExceptionFilter } from './filters/admin-exception.filter';
  import { CatchAllExceptionFilter } from './filters/catch-all.filter';
  import { ShutdownTrackerInterceptor } from './interceptors/shutdown-tracker.interceptor';
  import { RequestIdMiddleware } from './middleware/request-id.middleware';
  import { RequestClassifierMiddleware } from './middleware/request-classifier.middleware';

  @Global()
  @Module({
    imports: [AppConfigInternalModule],
    providers: [
      RequestIdMiddleware,
      RequestClassifierMiddleware,
      ShutdownTrackerInterceptor,
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      // Filters — LIFO order
      { provide: APP_FILTER, useClass: CatchAllExceptionFilter },
      { provide: APP_FILTER, useClass: AdminExceptionFilter },
      { provide: APP_FILTER, useClass: S3ExceptionFilter },
      { provide: APP_INTERCEPTOR, useClass: ShutdownTrackerInterceptor },
    ],
    exports: [AppConfigInternalModule, RequestIdMiddleware, RequestClassifierMiddleware],
  })
  export class CommonModule {}
  ```

## Acceptance criteria
- [ ] `CommonModule` is `@Global()`.
- [ ] Provider list matches §1.6 verbatim including LIFO filter order.
- [ ] `imports` contains exactly `AppConfigInternalModule`.
- [ ] `exports` re-exports the three items listed above.

## Test obligations
- Unit: covered by [TEST-0009]
- E2E: N/A — exercised by STORY-0012 e2e
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0013], [TASK-0015], [TASK-0022], [TASK-0025], [TASK-0026], [TASK-0027], [TASK-0031], [TASK-0039]

## References
- `docs/WHITEPAPER.md` §1.6 (lines 528–567)
