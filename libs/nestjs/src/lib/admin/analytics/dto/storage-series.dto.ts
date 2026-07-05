import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One point on the storage-over-time series. */
export const StoragePointSchema = z
  .object({
    t: z.string().datetime(),
    sizeBytes: z.number().int().nonnegative(),
    objectCount: z.number().int().nonnegative(),
  })
  .meta({ id: 'StoragePointDto' });

/**
 * Storage-over-time series (§STORY-1102). `bucket` is the bucket the series was
 * scoped to, or `null` for the instance-wide total. `points` is server-side
 * downsampled to `<= 500` entries and sorted ascending by `t`.
 */
export const StorageSeriesSchema = z
  .object({
    points: z.array(StoragePointSchema),
    bucket: z.string().nullable(),
  })
  .meta({ id: 'StorageSeriesDto' });

export class StorageSeriesDto extends createZodDto(StorageSeriesSchema) {}
