import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A single cross-bucket search hit (§STORY-1101, TASK-3311). `.meta({ id })`
 *  names it as a reusable OpenAPI component (zod 4) so the generated client emits
 *  a shared `ObjectSearchHit` model instead of an inline type. */
export const ObjectSearchHitSchema = z
  .object({
    bucket: z.string(),
    key: z.string(),
    size: z.number().int().nonnegative(),
    etag: z.string(),
    lastModified: z.string().datetime(),
    storageClass: z.string(),
    contentType: z.string().optional(),
  })
  .meta({ id: 'ObjectSearchHit' });

/** Response for cross-bucket object search — hits + keyset continuation. */
export const ObjectSearchResponseSchema = z.object({
  results: z.array(ObjectSearchHitSchema),
  isTruncated: z.boolean(),
  nextCursor: z.string().optional(),
});

export class ObjectSearchResponseDto extends createZodDto(ObjectSearchResponseSchema) {}
