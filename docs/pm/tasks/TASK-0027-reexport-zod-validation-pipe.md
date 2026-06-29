---
id: TASK-0027
title: Re-export ZodValidationPipe from nestjs-zod
story: STORY-0010
status: done
type: implementation
size: XS
---

## Description
Author `apps/backend/src/common/pipes/zod-validation.pipe.ts` re-exporting `ZodValidationPipe` from `nestjs-zod` per §1.6.3 ("re-exported from nestjs-zod with our settings"). Keeping the indirection lets us tweak global pipe settings without touching every importer.

## Files to create / modify
- `apps/openbucket-backend/src/common/pipes/zod-validation.pipe.ts` — new

## Implementation notes
- §1.1 line 75 (directory layout): `pipes/zod-validation.pipe.ts // re-exported from nestjs-zod with our settings`
- §1.6.3 (lines 702–704): "ZodValidationPipe from nestjs-zod is registered globally via APP_PIPE. … The pipe handles param/query/body validation uniformly and throws ZodValidationException on failure".
- Suggested body:
  ```ts
  export { ZodValidationPipe } from 'nestjs-zod';
  ```

## Acceptance criteria
- [ ] File exists and re-exports `ZodValidationPipe`.
- [ ] `CommonModule`'s `APP_PIPE` provider imports it from this file (not directly from `nestjs-zod`).

## Test obligations
- Unit: covered by [TEST-0011]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.6.3 (lines 702–705)
