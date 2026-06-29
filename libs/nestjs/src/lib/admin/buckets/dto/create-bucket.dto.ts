import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Request body for creating a bucket (§5.4.1). `.strict()` rejects unknown keys
 * so a typo'd field can't silently succeed.
 *
 * (The whitepaper imports `z` from `nestjs-zod/z`; that subpath was removed in
 * nestjs-zod v5, so the codebase uses plain `zod` — consistent with every other
 * DTO here. createZodDto consumes the schema the same way.)
 */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export const CreateBucketSchema = z
  .object({
    name: z
      .string()
      .min(3)
      .max(63)
      .regex(BUCKET_NAME, 'bucket name must match S3 naming rules'),
    versioning: z.enum(['disabled', 'enabled']).default('disabled'),
    objectLock: z.boolean().default(false),
    region: z.string().default('us-east-1'),
  })
  .strict();

export class CreateBucketDto extends createZodDto(CreateBucketSchema) {}
