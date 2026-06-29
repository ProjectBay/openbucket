import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bucket object-lock config (STORY-0612 / TASK-1860): enable flag + optional
 * default retention. Mirrors the persisted `ObjectLockBucketConfig`.
 */
export const ObjectLockConfigSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['off', 'governance', 'compliance']).optional(),
    defaultRetentionDays: z.number().int().positive().optional(),
  })
  .strict();

export class ObjectLockConfigDto extends createZodDto(ObjectLockConfigSchema) {}
