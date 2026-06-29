import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { BucketSummarySchema } from './bucket-summary.dto';

/** Response for the admin bucket listing (§5.4.2): the summaries plus a total. */
export const ListBucketsResponseSchema = z.object({
  buckets: z.array(BucketSummarySchema),
  total: z.number().int().nonnegative(),
});

export class ListBucketsResponseDto extends createZodDto(ListBucketsResponseSchema) {}
