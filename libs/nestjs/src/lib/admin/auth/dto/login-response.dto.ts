import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response body for login/refresh (§5.2.4): the short-lived access token and its
 * lifetime in seconds. The refresh token rides in the `ob_refresh` HttpOnly
 * cookie, never in the JSON body.
 */
export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
});

export class LoginResponseDto extends createZodDto(LoginResponseSchema) {}
