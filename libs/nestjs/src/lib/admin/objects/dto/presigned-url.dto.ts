import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Presigned-URL response (STORY-0612 / TASK-1863): the signed URL + its absolute
 * expiry instant.
 */
export const PresignedUrlSchema = z
  .object({
    url: z.string(),
    expiresAt: z.string(),
  })
  .meta({ id: 'PresignedUrlDto' });

export class PresignedUrlDto extends createZodDto(PresignedUrlSchema) {}
