import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Request body for the admin bulk-delete endpoint (STORY-0612 / TASK-1858):
 * a JSON `{ keys: [...] }` shape (vs the S3 `<Delete>` XML wire body). Capped at
 * 1000 entries to mirror the S3 DeleteObjects limit.
 */
const BulkDeleteEntrySchema = z
  .object({
    key: z.string().min(1),
    versionId: z.string().optional(),
  })
  .strict();

export const BulkDeleteSchema = z
  .object({
    keys: z.array(BulkDeleteEntrySchema).min(1).max(1000),
  })
  .strict();

export class BulkDeleteDto extends createZodDto(BulkDeleteSchema) {}
