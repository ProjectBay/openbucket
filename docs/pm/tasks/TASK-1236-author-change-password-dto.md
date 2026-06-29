---
id: TASK-1236
title: Author ChangePasswordDto
story: STORY-0412
status: done
type: implementation
size: XS
---

## Description
Author the change-password DTO with minimum length and required current/new fields.

## Files to create / modify
- `apps/backend/src/admin/settings/dto/change-password.dto.ts` — new

## Implementation notes
- Use the nestjs-zod pattern from §5.4; fields are inferred from the controller in §5.8:
  ```ts
  export const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(256),
  }).strict();
  export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
  ```
- Minimum length 12 for the new password is consistent with the 24-char generated temp password.

## Acceptance criteria
- [ ] Both fields required; `.strict()` rejects extras.
- [ ] New password rejected if shorter than 12 chars.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0417]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.8 (lines 7670–7691), §5.4 (lines 7145–7164)
