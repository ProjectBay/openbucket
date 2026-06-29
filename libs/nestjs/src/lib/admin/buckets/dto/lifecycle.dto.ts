import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bucket lifecycle config (STORY-0612 / TASK-1860). Mirrors the persisted
 * `LifecycleRule[]` shape; the rule item is a named component for clean codegen.
 */
const LifecycleRuleSchema = z
  .object({
    id: z.string(),
    status: z.enum(['Enabled', 'Disabled']),
    prefix: z.string().optional(),
    filter: z
      .object({
        tag: z.object({ key: z.string(), value: z.string() }).optional(),
        sizeGreaterThan: z.number().int().optional(),
        sizeLessThan: z.number().int().optional(),
      })
      .optional(),
    expirationDays: z.number().int().optional(),
    expiredObjectDeleteMarker: z.boolean().optional(),
    noncurrentVersionExpirationDays: z.number().int().optional(),
    abortIncompleteMultipartUploadDays: z.number().int().optional(),
  })
  .meta({ id: 'LifecycleRuleDto' });

export const LifecycleConfigSchema = z
  .object({ rules: z.array(LifecycleRuleSchema) })
  .strict();

export class LifecycleConfigDto extends createZodDto(LifecycleConfigSchema) {}
