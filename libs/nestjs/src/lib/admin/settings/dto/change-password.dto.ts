import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Body for `POST /api/admin/settings/change-password` (§5.8). `newPassword` has
 * a 12-char floor; validation is enforced by the global ZodValidationPipe.
 */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  newPassword: z.string().min(12, 'newPassword must be at least 12 characters'),
});

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
