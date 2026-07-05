import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ADMIN_ROLES } from '../../../persistence/entities/types';

/**
 * Body for `PATCH /api/admin/users/:username` (EPIC-11, STORY-1002): reassign the
 * role and/or reset the password. At least one field must be present (a no-op
 * patch is rejected at the DTO boundary). `newPassword` mirrors the 12-char
 * change-password floor; a reset also evicts the target's live sessions.
 */
export const UpdateAdminUserSchema = z
  .object({
    role: z.enum(ADMIN_ROLES).optional(),
    newPassword: z.string().min(12).optional(),
  })
  .refine((v) => v.role !== undefined || v.newPassword !== undefined, {
    message: 'nothing to update',
  });

export class UpdateAdminUserDto extends createZodDto(UpdateAdminUserSchema) {}
