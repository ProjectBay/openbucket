import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bucket tag set (STORY-0612 / TASK-1859) as a plain key/value map, replacing
 * the S3 `<Tagging>` XML body.
 */
export const TaggingSchema = z
  .object({
    tags: z.record(z.string(), z.string()),
  })
  .strict();

export class TaggingDto extends createZodDto(TaggingSchema) {}
