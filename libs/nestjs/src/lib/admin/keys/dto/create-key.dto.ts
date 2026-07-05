import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { KeyScope } from '../../../domain/keys/key-scope';

/**
 * Request body for creating an access key (§5.7). An optional `scope`
 * (EPIC-11) restricts the minted sub-key to a bucket/prefix (or an inline
 * policy); absent ⇒ an unscoped, root-equivalent sub-key. The `KeyScope` schema
 * bounds prefix length + serialized policy size so an oversized/malformed scope
 * is rejected at the DTO boundary (400) before it can reach the DB.
 */
export const CreateKeySchema = z
  .object({
    label: z.string().min(1).max(128),
    scope: KeyScope.optional(),
  })
  .strict();

export class CreateKeyDto extends createZodDto(CreateKeySchema) {}
