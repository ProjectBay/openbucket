import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Create-key response (§5.7). The ONLY place `secretAccessKey` is ever returned;
 * the secret is never persisted in plaintext and never surfaced again.
 */
export const CreatedKeySchema = z.object({
  id: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  label: z.string(),
  role: z.string(),
  createdAt: z.string().datetime(),
});

export class CreatedKeyDto extends createZodDto(CreatedKeySchema) {}
