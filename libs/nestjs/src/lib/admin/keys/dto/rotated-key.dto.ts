import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { KeyScopeViewSchema } from './key-summary.dto';

/**
 * Rotate-key response (§5.7, EPIC-11 TASK-3010). Mirrors `CreatedKeyDto`: the
 * ONLY place the rolled `secretAccessKey` is ever returned — the secret is never
 * persisted in plaintext and never surfaced again. `id`/`accessKeyId`/`scope`
 * are unchanged by a rotation (a secret roll, not a new key).
 */
export const RotatedKeySchema = z.object({
  id: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  label: z.string(),
  role: z.string(),
  createdAt: z.string().datetime(),
  scope: KeyScopeViewSchema.nullable(),
});

export class RotatedKeyDto extends createZodDto(RotatedKeySchema) {}
