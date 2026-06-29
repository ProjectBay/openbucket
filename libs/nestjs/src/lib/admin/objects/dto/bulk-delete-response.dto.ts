import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response for the admin bulk-delete endpoint (STORY-0612 / TASK-1858):
 * `{ deleted[], errors[] }`. Nested item schemas carry `.meta({ id })` so the
 * generated OpenAPI client emits named models instead of inline `*Inner` types.
 */
const BulkDeleteDeletedItemSchema = z
  .object({
    key: z.string(),
    versionId: z.string().optional(),
  })
  .meta({ id: 'BulkDeleteDeletedItem' });

const BulkDeleteErrorItemSchema = z
  .object({
    key: z.string(),
    versionId: z.string().optional(),
    code: z.string(),
    message: z.string(),
  })
  .meta({ id: 'BulkDeleteErrorItem' });

export const BulkDeleteResponseSchema = z
  .object({
    deleted: z.array(BulkDeleteDeletedItemSchema),
    errors: z.array(BulkDeleteErrorItemSchema),
  })
  .meta({ id: 'BulkDeleteResponseDto' });

export class BulkDeleteResponseDto extends createZodDto(BulkDeleteResponseSchema) {}
