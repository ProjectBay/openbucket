import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * One persisted audit event as returned by the viewer API (§5.9, STORY-1103).
 * `detail` is the parsed JSON object of the remaining whitelisted (secret-
 * stripped) fields, or null. `.meta({ id: 'AuditEvent' })` names the reusable
 * OpenAPI component so the generated client emits one shared `AuditEvent` model
 * (as `ObjectListItem`/`StoragePointDto` do), not an inline `...Inner` type.
 */
export const AuditEventSchema = z
  .object({
    id: z.string(),
    ts: z.string().datetime(),
    event: z.string(),
    subject: z.string().nullable(),
    requestId: z.string().nullable(),
    bucket: z.string().nullable(),
    objectKey: z.string().nullable(),
    keyId: z.string().nullable(),
    ip: z.string().nullable(),
    // Open-keyed object of the remaining whitelisted fields, or null.
    // `object().catchall` (not `z.record`) so the OpenAPI output-mode schema is
    // a plain `additionalProperties` object — `z.record` emits a `propertyNames`
    // constraint the typescript-angular generator's spec validator rejects.
    detail: z.object({}).catchall(z.unknown()).nullable(),
  })
  .meta({ id: 'AuditEvent' });

export class AuditEventDto extends createZodDto(AuditEventSchema) {}
