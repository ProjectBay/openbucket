---
id: TASK-0306
title: Declare express Request augmentation for req.openbucket
story: STORY-0100
status: done
type: implementation
size: XS
---

## Description
Author the TypeScript module augmentation declaring the `req.openbucket` field on Express's `Request` interface. The classifier middleware (EPIC-01) populates `kind`, `style`, `bucket`, `keyRaw`, `requestId`, `receivedAt`; this Story's controllers and the `@S3Operation` decorator additionally write `operation`; the `SigV4Guard` writes `accessKeyId`.

## Files to create / modify
- `apps/backend/src/common/openbucket-request.d.ts` — new

## Implementation notes
- Verbatim from §2.2 (lines 1249–1262):
  ```ts
  // apps/backend/src/common/openbucket-request.d.ts
  declare module 'express-serve-static-core' {
    interface Request {
      openbucket: {
        kind: 's3' | 'admin' | 'spa';
        style: 'virtual-host' | 'path';
        bucket: string | null;       // null only for ListBuckets (GET /)
        keyRaw: string | null;       // raw, not URL-decoded; null for bucket-scope
        requestId: string;           // UUID v7
        receivedAt: number;          // Date.now() at first byte
      };
    }
  }
  ```
- Extend the same interface with `operation?: string` (set by `@S3Operation` per §2.8 line 2492) and `accessKeyId?: string` (set by `SigV4Guard` per §2.4.3 line 1701 — `(req as any).openbucket.accessKeyId = parsed.accessKeyId;`).

## Acceptance criteria
- [ ] `req.openbucket` typed without `(req as any)` casts in subsequent code.
- [ ] `tsconfig.json` discovers the `.d.ts` file.

## Test obligations
- Unit: N/A — type-only
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [EPIC-01]

## References
- `docs/WHITEPAPER.md` §2.2 (lines 1249–1262), §2.4.3 (line 1701), §2.8 (line 2492)
