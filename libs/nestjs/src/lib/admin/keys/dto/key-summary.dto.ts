import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A stored access key as surfaced in admin listings (§5.7) — never the secret. */
export const KeySummarySchema = z.object({
  id: z.string(),
  accessKeyId: z.string(),
  label: z.string(),
  role: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  disabled: z.boolean(),
});

export class KeySummaryDto extends createZodDto(KeySummarySchema) {}
