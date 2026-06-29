import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Request body for creating an access key (§5.7). */
export const CreateKeySchema = z
  .object({
    label: z.string().min(1).max(128),
  })
  .strict();

export class CreateKeyDto extends createZodDto(CreateKeySchema) {}
