import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Request/error counts for one surface at one point in time. */
export const SurfaceCountsSchema = z
  .object({
    requestCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
  })
  .meta({ id: 'SurfaceCountsDto' });

/** One point on the request-metrics series, pivoted across the two surfaces. */
export const RequestPointSchema = z
  .object({
    t: z.string().datetime(),
    admin: SurfaceCountsSchema,
    s3: SurfaceCountsSchema,
  })
  .meta({ id: 'RequestPointDto' });

/**
 * Request/error series (§STORY-1102). `points` is server-side downsampled to
 * `<= 500` entries and sorted ascending by `t`.
 */
export const RequestSeriesSchema = z
  .object({
    points: z.array(RequestPointSchema),
  })
  .meta({ id: 'RequestSeriesDto' });

export class RequestSeriesDto extends createZodDto(RequestSeriesSchema) {}
