import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response body for `GET /api/admin/auth/me` (§5.2.4): the caller's identity and
 * password-rotation flag, echoed straight from the verified JWT claims (no DB
 * read). `id` is the JWT `sub` (the admin username, which is the primary key).
 */
export const MeResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  mustChangePassword: z.boolean(),
});

export class MeResponseDto extends createZodDto(MeResponseSchema) {}
