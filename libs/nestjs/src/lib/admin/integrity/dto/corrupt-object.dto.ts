import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * A single corrupt object in the admin corrupt-list (STORY-1204). `detail` is the
 * already-redacted 255-char column — the DTO NEVER carries a URL or credential.
 * `.meta({ id })` so the generated client emits a shared `CorruptObjectDto` model.
 */
export const CorruptObjectSchema = z
  .object({
    bucket: z.string(),
    key: z.string(),
    checkedAt: z.string().datetime().nullable(),
    detail: z.string().nullable(),
  })
  .meta({ id: 'CorruptObjectDto' });

/** One page of corrupt objects. */
export const CorruptListSchema = z.object({
  rows: z.array(CorruptObjectSchema),
  total: z.number().int().nonnegative(),
});

export class CorruptListDto extends createZodDto(CorruptListSchema) {}

/**
 * Query params for the corrupt-list. `limit` is capped at 200 and `offset` is
 * bounded so the route can't be turned into an unbounded scan (EPIC-08 DoS
 * posture). Coerced from the query string.
 */
export const CorruptQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export class CorruptQueryDto extends createZodDto(CorruptQuerySchema) {}
