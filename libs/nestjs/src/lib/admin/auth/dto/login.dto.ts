import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Body for `POST /api/admin/auth/login` (§5.2.4). Validated by the global
 * ZodValidationPipe; credential correctness is checked by AuthService.
 */
export const LoginSchema = z.object({
  username: z.string().min(1, 'username is required'),
  password: z.string().min(1, 'password is required'),
});

export class LoginDto extends createZodDto(LoginSchema) {}
