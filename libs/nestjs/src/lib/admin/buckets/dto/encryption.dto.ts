import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bucket default-encryption config (STORY-0612 / TASK-1859). Only SSE-S3
 * (AES256) is supported in v1; any other algorithm is a 400 ValidationFailed.
 */
export const EncryptionConfigSchema = z
  .object({
    algorithm: z.enum(['AES256']),
  })
  .strict();

export class EncryptionConfigDto extends createZodDto(EncryptionConfigSchema) {}
