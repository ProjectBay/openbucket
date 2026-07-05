import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Instance-wide integrity scrub summary (STORY-1204). Pure counts + a resume
 * cursor — never a remote endpoint or credential. `enabled` is false when the
 * scheduled scrub is off; the endpoint still 200s with zeroed/stale counters
 * (mirrors `getReplicationStatus`).
 */
export const IntegrityStatusSchema = z.object({
  enabled: z.boolean(),
  scanned: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  corrupt: z.number().int().nonnegative(),
  unchecked: z.number().int().nonnegative(),
  repaired: z.number().int().nonnegative(),
  lastRunAt: z.string().datetime().nullable(),
  /** Resume cursor `bucket/key`, or null when a fresh pass is about to start. */
  cursor: z.string().nullable(),
});

export class IntegrityStatusDto extends createZodDto(IntegrityStatusSchema) {}
