import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Object retention (STORY-0612 / TASK-1862): WORM mode + retain-until date,
 * replacing the S3 `<Retention>` XML sub-resource.
 */
export const RetentionSchema = z
  .object({
    mode: z.enum(['GOVERNANCE', 'COMPLIANCE']),
    retainUntil: z.string().datetime(),
  })
  .strict();

export class RetentionDto extends createZodDto(RetentionSchema) {}
