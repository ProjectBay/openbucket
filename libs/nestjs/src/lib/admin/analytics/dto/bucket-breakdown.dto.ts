import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One bucket's share of the latest storage snapshot. */
export const BucketBreakdownItemSchema = z
  .object({
    name: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    objectCount: z.number().int().nonnegative(),
    sharePct: z.number().min(0).max(100),
  })
  .meta({ id: 'BucketBreakdownItemDto' });

/**
 * Per-bucket storage breakdown of the most recent sample (§STORY-1102), limited
 * to still-existing buckets. `sharePct` values sum to ~100 (±rounding).
 */
export const BucketBreakdownSchema = z
  .object({
    buckets: z.array(BucketBreakdownItemSchema),
    totalSizeBytes: z.number().int().nonnegative(),
    totalObjectCount: z.number().int().nonnegative(),
  })
  .meta({ id: 'BucketBreakdownDto' });

export class BucketBreakdownDto extends createZodDto(BucketBreakdownSchema) {}
