---
id: TASK-0013
title: Implement RequestIdMiddleware
story: STORY-0006
status: done
type: implementation
size: XS
---

## Description
Author `apps/backend/src/common/middleware/request-id.middleware.ts` exactly as in §1.5. Validate an upstream `X-Request-Id` against `/^[0-9a-f-]{36}$/i` and re-use if matching; otherwise mint a fresh UUIDv7 via `uuid.v7`. Initialize `req.openbucket = { requestId, kind: 's3', receivedAt: 0 }`. Set both `X-Request-Id` and `X-Amz-Request-Id` response headers.

## Files to create / modify
- `apps/openbucket-backend/src/common/middleware/request-id.middleware.ts` — new

## Implementation notes
- Quote §1.5 (lines 492–518) verbatim:
  ```ts
  import { Injectable, NestMiddleware } from '@nestjs/common';
  import type { Request, Response, NextFunction } from 'express';
  import { v7 as uuidv7 } from 'uuid';

  import type { OpenBucketRequestContext } from '../types/request';

  @Injectable()
  export class RequestIdMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction): void {
      const incoming = req.headers['x-request-id'];
      const requestId =
        typeof incoming === 'string' && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : uuidv7();

      const ctx: OpenBucketRequestContext = {
        requestId,
        kind: 's3',
        receivedAt: 0,
      };
      req.openbucket = ctx;

      res.setHeader('X-Request-Id', requestId);
      res.setHeader('X-Amz-Request-Id', requestId);
      next();
    }
  }
  ```
- "UUIDv7 is mandated: lexicographically sortable by timestamp." — §1.5 final note.

## Acceptance criteria
- [ ] File matches §1.5 quote verbatim.
- [ ] Both response headers emitted with the same value as `req.openbucket.requestId`.
- [ ] Invalid `X-Request-Id` is replaced with a fresh UUIDv7.

## Test obligations
- Unit: covered by [TEST-0006]
- E2E: N/A — exercised by STORY-0007 e2e
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0011], [TASK-0014]

## References
- `docs/WHITEPAPER.md` §1.5 (lines 491–521)
