import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Presign request (STORY-0612 / TASK-1863): desired lifetime in seconds. Capped
 * server-side at MAX_EXPIRES (7 days); must be >= 1.
 */
export const PresignRequestSchema = z
  .object({
    expiresIn: z.number().int().min(1),
  })
  .strict();

export class PresignRequestDto extends createZodDto(PresignRequestSchema) {}
