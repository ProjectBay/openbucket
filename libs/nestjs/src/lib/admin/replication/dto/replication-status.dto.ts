import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Operator-facing replication read model (STORY-0902). Aggregated from the
 * durable `replication_outbox` — pure counts + lag, no remote calls. Every
 * nested object is a `.meta({ id })` named component (zod 4) so the generated
 * client emits shared `BucketReplicationStatusDto` / `ReplicationLastErrorDto`
 * models instead of inline `...Inner` shapes (mirrors `ObjectListItem`).
 */

/** Per-bucket replication depth + lag. */
export const BucketReplicationStatusSchema = z
  .object({
    bucket: z.string(),
    pendingCount: z.number().int().nonnegative(),
    inflightCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    /** Age (ms) of the oldest pending intent for this bucket; null when none. */
    oldestPendingAgeMs: z.number().int().nonnegative().nullable(),
  })
  .meta({ id: 'BucketReplicationStatusDto' });

/**
 * The newest outbox failure, projected to the row's OWN coordinates only. The
 * remote endpoint, target bucket and credentials are NEVER surfaced here.
 */
export const ReplicationLastErrorSchema = z
  .object({
    message: z.string(),
    at: z.string().datetime(),
    bucket: z.string().optional(),
    key: z.string().optional(),
  })
  .meta({ id: 'ReplicationLastErrorDto' });

/** Instance-wide replication status. `enabled` is false when no target is
 *  configured; all counters are then zero (the endpoint still 200s). */
export const ReplicationStatusSchema = z.object({
  enabled: z.boolean(),
  pendingCount: z.number().int().nonnegative(),
  inflightCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  oldestPendingAgeMs: z.number().int().nonnegative().nullable(),
  lastError: ReplicationLastErrorSchema.nullable(),
  perBucket: z.array(BucketReplicationStatusSchema),
});

export class ReplicationStatusDto extends createZodDto(ReplicationStatusSchema) {}
