import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Scheduled-backup status (STORY-1203, TASK-3634). Deliberately REDACTED: carries
 * counts / timestamps / policy numbers only — never the absolute snapshot `dir`
 * (a host path), credentials, or object keys — matching the counts-only posture
 * of `RequestMetricsService` and the EPIC-08 secret-redaction rule. `lastError`
 * is the already-truncated snapshot error string (no paths). `.strict()` rejects
 * unknown keys.
 */
export const ScheduleStatusSchema = z
  .object({
    enabled: z.boolean(),
    scope: z.enum(['instance', 'buckets']),
    schedule: z
      .object({
        cron: z.string().optional(),
        intervalMinutes: z.number().int().optional(),
      })
      .strict()
      .meta({ id: 'ScheduleSpecDto' }),
    lastRunAt: z.string().datetime().nullable(),
    nextRunAt: z.string().datetime().nullable(),
    lastStatus: z.enum(['ok', 'error', 'skipped']),
    lastError: z.string().nullable(),
    lastDurationMs: z.number().int().nonnegative(),
    lastBytes: z.number().int().nonnegative(),
    lastObjectCount: z.number().int().nonnegative(),
    keepLast: z.number().int().positive(),
    maxAgeDays: z.number().int().positive(),
    snapshotCount: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: 'ScheduleStatusDto' });

export class ScheduleStatusDto extends createZodDto(ScheduleStatusSchema) {}

/**
 * Result of a run-now request. `started: true` when this call kicked off the
 * cycle; `false` when it joined an already-in-flight cycle (the in-flight join is
 * the DoS guard — a flood can't spawn N concurrent snapshots).
 */
export const RunNowResultSchema = z
  .object({ started: z.boolean() })
  .strict()
  .meta({ id: 'RunNowResultDto' });

export class RunNowResultDto extends createZodDto(RunNowResultSchema) {}
