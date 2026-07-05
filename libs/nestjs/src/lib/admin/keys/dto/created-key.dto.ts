import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { KeyScopeViewSchema } from './key-summary.dto';

/**
 * Create-key response (§5.7). The ONLY place `secretAccessKey` is ever returned;
 * the secret is never persisted in plaintext and never surfaced again. Echoes
 * the compiled `scope` view (EPIC-11), or null for an unscoped key.
 */
export const CreatedKeySchema = z.object({
  id: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  label: z.string(),
  role: z.string(),
  createdAt: z.string().datetime(),
  scope: KeyScopeViewSchema.nullable(),
});

export class CreatedKeyDto extends createZodDto(CreatedKeySchema) {}
