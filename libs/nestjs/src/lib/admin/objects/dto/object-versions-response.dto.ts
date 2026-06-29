import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Object versions + delete markers (STORY-0612 / TASK-1861). Nested item schemas
 * are named components so the generated client emits real models, not inline types.
 */
const ObjectVersionSchema = z
  .object({
    key: z.string(),
    versionId: z.string(),
    isLatest: z.boolean(),
    lastModified: z.string(),
    etag: z.string(),
    size: z.number().int().nonnegative(),
  })
  .meta({ id: 'ObjectVersionDto' });

const DeleteMarkerSchema = z
  .object({
    key: z.string(),
    versionId: z.string(),
    isLatest: z.boolean(),
    lastModified: z.string(),
  })
  .meta({ id: 'DeleteMarkerDto' });

export const ObjectVersionsResponseSchema = z
  .object({
    versions: z.array(ObjectVersionSchema),
    deleteMarkers: z.array(DeleteMarkerSchema),
    isTruncated: z.boolean(),
    nextKeyMarker: z.string().optional(),
    nextVersionIdMarker: z.string().optional(),
  })
  .meta({ id: 'ObjectVersionsResponseDto' });

export class ObjectVersionsResponseDto extends createZodDto(ObjectVersionsResponseSchema) {}
