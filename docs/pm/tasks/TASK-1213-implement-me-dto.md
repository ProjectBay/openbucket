---
id: TASK-1213
title: Author MeResponseDto
story: STORY-0406
status: done
type: implementation
size: XS
---

## Description
Author the nestjs-zod DTO for the `/me` endpoint response.

## Files to create / modify
- `apps/backend/src/admin/auth/dto/me-response.dto.ts` — new

## Implementation notes
- Shape per §5.2.4 lines 7048–7054:
  ```ts
  export const MeResponseSchema = z.object({
    id: z.string(),
    username: z.string(),
    mustChangePassword: z.boolean(),
  });
  export class MeResponseDto extends createZodDto(MeResponseSchema) {}
  ```

## Acceptance criteria
- [ ] `MeResponseDto` extends `createZodDto(MeResponseSchema)`.
- [ ] Three required fields: `id`, `username`, `mustChangePassword`.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0407]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7048–7054)
