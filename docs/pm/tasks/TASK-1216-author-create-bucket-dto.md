---
id: TASK-1216
title: Author CreateBucketDto with strict regex schema
story: STORY-0408
status: done
type: implementation
size: XS
---

## Description
Author the bucket-create DTO as a `.strict()` Zod schema with an S3 bucket-name regex and defaults.

## Files to create / modify
- `apps/backend/src/admin/buckets/dto/create-bucket.dto.ts` — new

## Implementation notes
- Verbatim from §5.4.1 (lines 7168–7191):
  ```ts
  import { createZodDto } from 'nestjs-zod';
  import { z } from 'nestjs-zod/z';

  const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

  export const CreateBucketSchema = z
    .object({
      name: z.string().min(3).max(63).regex(BUCKET_NAME, 'bucket name must match S3 naming rules'),
      versioning: z.enum(['disabled', 'enabled']).default('disabled'),
      objectLock: z.boolean().default(false),
      region: z.string().default('us-east-1'),
    })
    .strict();

  export class CreateBucketDto extends createZodDto(CreateBucketSchema) {}
  ```
- `.strict()` rejects unknown keys — quiet defense against typo'd request bodies silently succeeding.

## Acceptance criteria
- [ ] Regex matches valid S3 names; rejects uppercase, underscores, leading/trailing dot/dash.
- [ ] Defaults apply when fields omitted.
- [ ] Unknown keys are rejected by `.strict()`.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0411]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.4.1 (lines 7166–7191)
