---
id: TASK-0011
title: Author request.d.ts module augmentation
story: STORY-0005
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/types/request.d.ts` per §1.4. Declare `interface Request { openbucket: OpenBucketRequestContext }` inside `declare module 'express'` and export the `OpenBucketRequestContext` interface with the eight fields from §1.4.

## Files to create / modify
- `apps/openbucket-backend/src/common/types/request.d.ts` — new

## Implementation notes
- Quote §1.4 (lines 349–378) verbatim:
  ```ts
  import 'express';

  declare module 'express' {
    interface Request {
      openbucket: OpenBucketRequestContext;
    }
  }

  export interface OpenBucketRequestContext {
    requestId: string;
    kind: 's3' | 'admin' | 'spa';
    receivedAt: number;
    bucket?: string;
    key?: string;
    addressingStyle?: 'virtual-host' | 'path';
    s3Scope?: 's3-service' | 's3-bucket' | 's3-object';
  }
  ```
- JSDoc comments on each field per §1.4 should be preserved verbatim.

## Acceptance criteria
- [ ] File exists at the path above.
- [ ] `OpenBucketRequestContext` exports all eight fields with the documented unions.
- [ ] `req.openbucket.requestId` resolves to `string` in any backend file once `request.d.ts` is included via `types`.

## Test obligations
- Unit: covered by [TEST-0005]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.4 (lines 349–378)
