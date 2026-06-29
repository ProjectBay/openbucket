import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Object legal-hold (STORY-0612 / TASK-1862): ON/OFF, replacing the S3
 * `<LegalHold>` XML sub-resource.
 */
export const LegalHoldSchema = z
  .object({
    status: z.enum(['ON', 'OFF']),
  })
  .strict();

export class LegalHoldDto extends createZodDto(LegalHoldSchema) {}
