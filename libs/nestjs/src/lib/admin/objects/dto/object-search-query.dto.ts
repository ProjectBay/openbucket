import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Query string for cross-bucket object search (§STORY-1101, TASK-3311).
 * `z.coerce.number()` on `limit` is essential — Express delivers every query
 * value as a string.
 *
 * Two refinements harden the endpoint:
 *  - `contains` requires a trimmed `q` of length >= 2 — a DoS guard against a
 *    `%%`-style full-table substring scan (the unindexed path).
 *  - `tagKey`/`tagValue` must be supplied together (an exact-match index filter
 *    is meaningless with only half the pair).
 */
export const ObjectSearchQuerySchema = z
  .object({
    q: z.string().min(1).max(1024),
    mode: z.enum(['prefix', 'contains']).default('prefix'),
    bucket: z.string().max(255).optional(),
    tagKey: z.string().max(128).optional(),
    tagValue: z.string().max(256).optional(),
    cursor: z.string().max(4096).optional(), // opaque base64url keyset cursor
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => v.mode !== 'contains' || v.q.trim().length >= 2, {
    message: 'contains mode requires q of length >= 2',
    path: ['q'],
  })
  .refine((v) => (v.tagKey === undefined) === (v.tagValue === undefined), {
    message: 'tagKey and tagValue must be provided together',
    path: ['tagValue'],
  });

export class ObjectSearchQueryDto extends createZodDto(ObjectSearchQuerySchema) {}
