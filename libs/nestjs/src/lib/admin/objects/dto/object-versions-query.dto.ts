import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Query string for the admin object-version listing (STORY-0612 / TASK-1861).
 * `z.coerce.number()` — Express delivers query values as strings.
 */
export const ObjectVersionsQuerySchema = z.object({
  prefix: z.string().max(1024).optional(),
  keyMarker: z.string().max(1024).optional(),
  versionIdMarker: z.string().max(1024).optional(),
  maxKeys: z.coerce.number().int().min(1).max(1000).default(100),
});

export class ObjectVersionsQueryDto extends createZodDto(ObjectVersionsQuerySchema) {}
