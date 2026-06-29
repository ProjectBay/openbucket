import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bucket policy (STORY-0612 / TASK-1860). The policy document is stored verbatim
 * as opaque JSON; the domain validates it is a non-array object.
 */
export const BucketPolicySchema = z
  .object({
    policy: z.record(z.string(), z.unknown()),
  })
  .strict();

export class BucketPolicyDto extends createZodDto(BucketPolicySchema) {}
