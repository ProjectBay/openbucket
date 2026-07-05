import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { PolicyDocumentSchema } from '../../../domain/keys/key-scope';

/**
 * Effective-permissions response (§5.7, EPIC-11 TASK-3012). A read-only
 * projection of what a key can do: the compiled scope `PolicyDocument` (exactly
 * what the S3 path enforces — never the secret) plus an allow/deny matrix over a
 * fixed action catalogue crossed with the key's scoped resources. `scoped` is
 * false for a root/unscoped key (allow everywhere). The matrix reflects
 * action/resource reachability under `aws:SecureTransport: true` — not per-request
 * network conditions.
 */
export const EffectivePermissionsSchema = z.object({
  scoped: z.boolean(),
  scope: PolicyDocumentSchema.nullable(),
  matrix: z.array(
    z.object({
      action: z.string(),
      resource: z.string(),
      decision: z.enum(['allow', 'deny']),
    }),
  ),
});

export class EffectivePermissionsDto extends createZodDto(EffectivePermissionsSchema) {}
