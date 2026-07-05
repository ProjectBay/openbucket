import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A single object row in an admin listing (§5.6). `.meta({ id })` names it as a
 *  reusable OpenAPI component (zod 4) so the generated client emits a shared
 *  `ObjectListItem` model instead of an inline `...ContentsInner` type. */
export const ObjectListItemSchema = z
  .object({
    key: z.string(),
    size: z.number().int().nonnegative(),
    etag: z.string(),
    lastModified: z.string().datetime(),
    storageClass: z.string(),
    // Tiering location badge (STORY-0901): `local` vs `remote`/`rehydrating`.
    location: z.string(),
  })
  .meta({ id: 'ObjectListItem' });

/** Response for the admin object browser listing (§5.6). */
export const ListObjectsResponseSchema = z.object({
  bucket: z.string(),
  prefix: z.string(),
  delimiter: z.string().optional(),
  marker: z.string().optional(),
  nextMarker: z.string().optional(),
  isTruncated: z.boolean(),
  contents: z.array(ObjectListItemSchema),
  commonPrefixes: z.array(z.string()),
});

export class ListObjectsResponseDto extends createZodDto(ListObjectsResponseSchema) {}
