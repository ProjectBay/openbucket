---
id: TASK-1229
title: Author CreateKeyDto, UpdateKeyDto, KeySummaryDto, CreatedKeyDto
story: STORY-0411
status: done
type: implementation
size: S
---

## Description
Author the four access-key DTOs used by the keys admin controller.

## Files to create / modify
- `apps/backend/src/admin/keys/dto/create-key.dto.ts` — new
- `apps/backend/src/admin/keys/dto/update-key.dto.ts` — new
- `apps/backend/src/admin/keys/dto/key-summary.dto.ts` — new
- `apps/backend/src/admin/keys/dto/created-key.dto.ts` — new

## Implementation notes
- `CreateKeyDto` verbatim from §5.7 (lines 7558–7567):
  ```ts
  export const CreateKeySchema = z.object({
    label: z.string().min(1).max(128),
  }).strict();
  export class CreateKeyDto extends createZodDto(CreateKeySchema) {}
  ```
- `UpdateKeyDto` verbatim from §5.7 (lines 7569–7581):
  ```ts
  export const UpdateKeySchema = z.object({
    label: z.string().min(1).max(128).optional(),
    disabled: z.boolean().optional(),
  }).strict().refine((v) => v.label !== undefined || v.disabled !== undefined, {
    message: 'at least one field required',
  });
  export class UpdateKeyDto extends createZodDto(UpdateKeySchema) {}
  ```
- `KeySummarySchema` derived from controller return shape (§5.7 lines 7477–7486):
  ```ts
  export const KeySummarySchema = z.object({
    id: z.string(),
    accessKeyId: z.string(),
    label: z.string(),
    role: z.string(),  // 'root' for v1
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    disabled: z.boolean(),
  });
  ```
- `CreatedKeySchema` (lines 7504–7510) — same as KeySummary minus `lastUsedAt`/`disabled` plus required `secretAccessKey` (returned ONCE):
  ```ts
  export const CreatedKeySchema = z.object({
    id: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    label: z.string(),
    role: z.string(),
    createdAt: z.string().datetime(),
  });
  ```

## Acceptance criteria
- [ ] All four DTOs extend `createZodDto`.
- [ ] `UpdateKeySchema` rejects empty objects with message `'at least one field required'`.
- [ ] `CreatedKeyDto` carries `secretAccessKey`; `KeySummaryDto` does not.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0415]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.7 (lines 7477–7510, 7558–7582)
