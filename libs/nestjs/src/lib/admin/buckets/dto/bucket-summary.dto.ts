import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shape for a single bucket in admin listings (§5.4.2). The response
 * `versioning` enum carries the extra `'suspended'` state that a created bucket
 * cannot start in.
 */
export const BucketSummarySchema = z
  .object({
    name: z.string(),
    createdAt: z.string().datetime(),
    versioning: z.enum(['disabled', 'enabled', 'suspended']),
    objectLock: z.boolean(),
    objectCount: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
  })
  // Named component (zod 4) so the `buckets` array in ListBucketsResponseDto
  // $refs this instead of emitting an inline `...BucketsInner` model. Matches
  // the createZodDto class name below so the two unify into one schema.
  .meta({ id: 'BucketSummaryDto' });

export class BucketSummaryDto extends createZodDto(BucketSummarySchema) {}
