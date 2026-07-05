import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Query string for the audit viewer (§5.9, STORY-1103). Express delivers query
 * values as strings, so `limit` is `z.coerce`d. `event`/`subject`/`bucket`
 * filter INDEXED columns by EXACT value (never LIKE — no metachar/scan concern,
 * EPIC-08 posture); `from`/`to` bound the `ts` range; `cursor` is the opaque
 * keyset token from a previous page. `limit` is hard-capped at 200 so every
 * response is bounded.
 */
export const AuditQuerySchema = z.object({
  event: z.string().max(64).optional(),
  subject: z.string().max(256).optional(),
  bucket: z.string().max(256).optional(),
  from: z.string().datetime().optional(), // ISO 8601
  to: z.string().datetime().optional(),
  cursor: z.string().max(256).optional(), // opaque, from a previous page
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export class AuditQueryDto extends createZodDto(AuditQuerySchema) {}
