import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bucket versioning config (STORY-0612 / TASK-1859). S3 has no transition back
 * to Disabled, so only Enabled/Suspended are accepted.
 */
export const VersioningConfigSchema = z
  .object({
    status: z.enum(['Enabled', 'Suspended']),
  })
  .strict();

export class VersioningConfigDto extends createZodDto(VersioningConfigSchema) {}
