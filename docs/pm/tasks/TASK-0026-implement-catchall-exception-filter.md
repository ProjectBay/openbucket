---
id: TASK-0026
title: Implement CatchAllExceptionFilter
story: STORY-0010
status: done
type: implementation
size: XS
---

## Description
Author `apps/backend/src/common/filters/catch-all.filter.ts` as the last-resort filter described in §1.6.2 (line 700). It is a one-line log + 500 with no body, registered below both kind-specific filters so it only fires for requests the classifier left in an undefined state.

## Files to create / modify
- `apps/openbucket-backend/src/common/filters/catch-all.filter.ts` — new

## Implementation notes
- §1.6.2 line 700: "The catch-all is a one-line last-resort filter that logs and returns `500` with no body, registered below both kind-specific filters so it only fires for requests the classifier left in an undefined state (theoretically unreachable; it's defence in depth)."
- Suggested shape:
  ```ts
  import { Catch, ExceptionFilter, ArgumentsHost, Logger } from '@nestjs/common';
  import type { Response } from 'express';

  @Catch()
  export class CatchAllExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(CatchAllExceptionFilter.name);
    catch(exception: unknown, host: ArgumentsHost): void {
      this.logger.error({ err: exception }, 'Unclassified exception');
      const res = host.switchToHttp().getResponse<Response>();
      res.status(500).end();
    }
  }
  ```

## Acceptance criteria
- [ ] Filter logs `'Unclassified exception'` with the error and returns status 500 with no body.
- [ ] Registered as the first `APP_FILTER` provider in `CommonModule` (bottom of LIFO stack).

## Test obligations
- Unit: covered by [TEST-0011]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.6.2 (lines 700–701)
