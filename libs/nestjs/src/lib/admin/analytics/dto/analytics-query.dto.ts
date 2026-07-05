import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The allow-listed time windows. The enum IS the DoS guard: no free-form range,
 *  so no unbounded scan of the sample tables (EPIC-08 STORY-0704 posture). */
export const ANALYTICS_RANGES = ['1h', '24h', '7d', '30d', '90d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/**
 * Query string for the analytics endpoints (§STORY-1102). `range` selects the
 * window; the optional `bucket` narrows the storage series to one bucket via
 * EXACT equality (never LIKE — sidesteps the metachar concern from STORY-0706).
 */
export const AnalyticsQuerySchema = z.object({
  range: z.enum(ANALYTICS_RANGES).default('7d'),
  bucket: z.string().max(63).optional(),
});

export class AnalyticsQueryDto extends createZodDto(AnalyticsQuerySchema) {}
