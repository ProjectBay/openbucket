import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Object tag set (STORY-0612 / TASK-1861) as a plain key/value map, replacing
 * the S3 `<Tagging>` XML body.
 */
export const ObjectTaggingSchema = z
  .object({
    tags: z.record(z.string(), z.string()),
  })
  .strict();

export class ObjectTaggingDto extends createZodDto(ObjectTaggingSchema) {}
