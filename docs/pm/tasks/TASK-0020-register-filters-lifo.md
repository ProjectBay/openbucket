---
id: TASK-0020
title: Register global filters in LIFO order
story: STORY-0008
status: done
type: implementation
size: XS
---

## Description
Verify (and codify in `common.module.ts`) the LIFO ordering of `APP_FILTER` providers: `CatchAllExceptionFilter` first (bottom), then `AdminExceptionFilter`, then `S3ExceptionFilter` (top). Nest applies filters in reverse-registration order, so the first match-and-handle wins.

## Files to create / modify
- `apps/openbucket-backend/src/common/common.module.ts` — modify

## Implementation notes
- Quote §1.6 (lines 552–556):
  ```
  // Filters — order is LIFO. The catch-all is registered first so it sits at
  // the bottom; the kind-specific filters above it intercept first.
  { provide: APP_FILTER, useClass: CatchAllExceptionFilter },
  { provide: APP_FILTER, useClass: AdminExceptionFilter },
  { provide: APP_FILTER, useClass: S3ExceptionFilter },
  ```

## Acceptance criteria
- [ ] Provider array contains the three filters in the exact order: catch-all, admin, S3.
- [ ] A unit test verifies that an `S3Error` thrown from an `'s3'`-classified request is handled by `S3ExceptionFilter` (not `AdminExceptionFilter`).

## Test obligations
- Unit: covered by [TEST-0009]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0019]

## References
- `docs/WHITEPAPER.md` §1.6 (lines 552–556)
