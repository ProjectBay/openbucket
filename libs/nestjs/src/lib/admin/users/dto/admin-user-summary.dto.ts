import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ADMIN_ROLES } from '../../../persistence/entities/types';

/**
 * An admin user as surfaced in listings (EPIC-11, STORY-1002). NEVER carries
 * `passwordHash` — the summary is the outward projection and must stay
 * secret-free (mirrors the key-summary posture).
 */
export const AdminUserSummarySchema = z.object({
  username: z.string(),
  role: z.enum(ADMIN_ROLES),
  mustChangePassword: z.boolean(),
  createdAt: z.string().datetime(),
});

export class AdminUserSummaryDto extends createZodDto(AdminUserSummarySchema) {}
