import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Compact, secret-free view of a key's scope (EPIC-11) surfaced in listings. */
export const KeyScopeViewSchema = z.object({
  kind: z.enum(['prefix', 'policy']),
  bucket: z.string().optional(),
  prefix: z.string().optional(),
});

/** A stored access key as surfaced in admin listings (§5.7) — never the secret. */
export const KeySummarySchema = z.object({
  id: z.string(),
  accessKeyId: z.string(),
  label: z.string(),
  role: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  disabled: z.boolean(),
  /** The key's scope summary, or null for an unscoped key. Never the secret. */
  scope: KeyScopeViewSchema.nullable(),
});

export class KeySummaryDto extends createZodDto(KeySummarySchema) {}
