import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Query string for listing objects in a bucket (§5.4.3). `z.coerce.number()` is
 * essential — Express delivers every query value as a string.
 */
export const ListObjectsQuerySchema = z.object({
  prefix: z.string().max(1024).optional(),
  delimiter: z.string().max(1).optional(), // typically '/'
  marker: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export class ListObjectsQueryDto extends createZodDto(ListObjectsQuerySchema) {}
