---
id: TASK-1208
title: Author LoginDto and LoginResponseDto
story: STORY-0403
status: done
type: implementation
size: XS
---

## Description
Author the two nestjs-zod DTOs the login endpoint consumes and returns.

## Files to create / modify
- `apps/backend/src/admin/auth/dto/login.dto.ts` — new
- `apps/backend/src/admin/auth/dto/login-response.dto.ts` — new

## Implementation notes
- Use the `createZodDto` pattern from §5.4:
  ```ts
  export const LoginSchema = z.object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  }).strict();
  export class LoginDto extends createZodDto(LoginSchema) {}
  ```
- `LoginResponseDto` shape per §5.2.4 controller return type: `{ accessToken: string, expiresIn: number }`:
  ```ts
  export const LoginResponseSchema = z.object({
    accessToken: z.string(),
    expiresIn: z.number().int().positive(),
  });
  export class LoginResponseDto extends createZodDto(LoginResponseSchema) {}
  ```

## Acceptance criteria
- [ ] `LoginSchema` is `.strict()`.
- [ ] Both DTOs extend `createZodDto` and are importable from the controller.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0404]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7010–7019), §5.4 (lines 7145–7164)
