import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The static v1 audit-event catalogue (§5.9, STORY-1103) — the event names the
 * viewer's filter dropdown offers. Served from `AUDIT_EVENT_CATALOG` so the SPA
 * needs no `distinct` table scan.
 */
export const AuditCatalogSchema = z.object({
  events: z.array(z.string()),
});

export class AuditCatalogDto extends createZodDto(AuditCatalogSchema) {}
