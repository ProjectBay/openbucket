import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ADMIN_ROLES } from '../../../persistence/entities/types';

/**
 * Response body for `GET /api/admin/auth/me` (§5.2.4): the caller's identity,
 * password-rotation flag, and authorization role (EPIC-11), echoed from the
 * request principal — whose `role` the guard already refreshed from the live DB.
 * `id` is the JWT `sub` (the admin username, which is the primary key).
 */
export const MeResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  mustChangePassword: z.boolean(),
  role: z.enum(ADMIN_ROLES),
});

export class MeResponseDto extends createZodDto(MeResponseSchema) {}
