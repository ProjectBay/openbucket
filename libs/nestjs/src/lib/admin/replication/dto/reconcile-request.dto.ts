import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Request body for `POST /api/admin/replication/reconcile` (STORY-0902). An
 * omitted `bucket` means a whole-instance reconcile; a present one scopes the
 * scan to that bucket. `.strict()` rejects unknown keys so a typo can't silently
 * widen the scope.
 */
export const ReconcileRequestSchema = z
  .object({
    bucket: z.string().min(1).optional(),
  })
  .strict();

export class ReconcileRequestDto extends createZodDto(ReconcileRequestSchema) {}
