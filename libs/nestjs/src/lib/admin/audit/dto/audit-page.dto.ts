import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AuditEventSchema } from './audit-event.dto';

/**
 * One page of audit events (§5.9, STORY-1103). `items` is newest-first;
 * `nextCursor` is the opaque keyset token to fetch the following page, or null
 * when this is the last page.
 */
export const AuditPageSchema = z.object({
  items: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});

export class AuditPageDto extends createZodDto(AuditPageSchema) {}
