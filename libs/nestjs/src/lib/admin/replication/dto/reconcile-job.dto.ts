import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Durable reconcile-job state returned by the start + poll endpoints
 * (STORY-0902). `.meta({ id })` names it a shared component so both
 * `startReconcile` and `getReconcileJob` reference one `ReconcileJobDto` model.
 * `error` is a redacted message only — never a remote endpoint/credential.
 */
export const ReconcileJobSchema = z
  .object({
    jobId: z.string(),
    scope: z.enum(['instance', 'bucket']),
    bucket: z.string().optional(),
    state: z.enum(['queued', 'running', 'completed', 'failed']),
    localScanned: z.number().int().nonnegative(),
    remoteScanned: z.number().int().nonnegative(),
    missingRequeued: z.number().int().nonnegative(),
    /** Null while the job is still `queued` (not yet picked up by the runner). */
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'ReconcileJobDto' });

export class ReconcileJobDto extends createZodDto(ReconcileJobSchema) {}
