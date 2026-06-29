---
id: TASK-0039
title: Implement ShutdownTrackerInterceptor
story: STORY-0014
status: done
type: implementation
size: XS
---

## Description
Author `apps/backend/src/common/interceptors/shutdown-tracker.interceptor.ts` per §1.10. The interceptor calls `state.enter()` before `next.handle()` and uses RxJS `finalize` to call `state.leave()` on completion (success or error).

## Files to create / modify
- `apps/openbucket-backend/src/common/interceptors/shutdown-tracker.interceptor.ts` — new

## Implementation notes
- Quote §1.10 (lines 969–984) verbatim:
  ```ts
  import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
  import { Observable, finalize } from 'rxjs';
  import { ShutdownState } from '../shutdown-state.service';

  @Injectable()
  export class ShutdownTrackerInterceptor implements NestInterceptor {
    constructor(private readonly state: ShutdownState) {}

    intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
      this.state.enter();
      return next.handle().pipe(finalize(() => this.state.leave()));
    }
  }
  ```

## Acceptance criteria
- [ ] File matches the verbatim quote.
- [ ] `enter()` runs before `next.handle()`.
- [ ] `leave()` runs on both success and error paths via `finalize`.

## Test obligations
- Unit: covered by [TEST-0015]
- E2E: N/A — exercised by STORY-0015 e2e
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0037]

## References
- `docs/WHITEPAPER.md` §1.10 (lines 968–984)
