import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ADMIN_ROLES } from '../../../persistence/entities/types';

/**
 * Body for `POST /api/admin/users` (EPIC-11, STORY-1002). `username` is bounded
 * to the AdminUser PK `length: 64` and the safe key-character set; `password`
 * carries the same 12-char floor as change-password. `role` is validated by
 * `z.enum`, so an unknown role is a 400 before it can reach the DB.
 */
export const CreateAdminUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'invalid username'),
  password: z.string().min(12, 'password must be at least 12 characters'),
  role: z.enum(ADMIN_ROLES),
});

export class CreateAdminUserDto extends createZodDto(CreateAdminUserSchema) {}
