import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Object metadata for the admin browser (§5.6), echoed from the stored pointer
 * row. (The whitepaper lists `contentEncoding`, but the object entity does not
 * store it yet, so it is omitted rather than always-null.)
 */
export const ObjectMetaSchema = z.object({
  key: z.string(),
  bucket: z.string(),
  size: z.number().int().nonnegative(),
  etag: z.string(),
  contentType: z.string(),
  lastModified: z.string().datetime(),
  userMetadata: z.record(z.string(), z.string()).optional(),
  tagging: z.record(z.string(), z.string()).optional(),
  versionId: z.string().optional(),
  storageClass: z.string(),
});

export class ObjectMetaDto extends createZodDto(ObjectMetaSchema) {}
