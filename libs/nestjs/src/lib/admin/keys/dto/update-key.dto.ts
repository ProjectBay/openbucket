import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Request body for updating an access key (§5.7): relabel and/or disable. At
 * least one field must be present, and unknown keys are rejected.
 */
export const UpdateKeySchema = z
  .object({
    label: z.string().min(1).max(128).optional(),
    disabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.label !== undefined || v.disabled !== undefined, {
    message: 'at least one field required',
  });

export class UpdateKeyDto extends createZodDto(UpdateKeySchema) {}
