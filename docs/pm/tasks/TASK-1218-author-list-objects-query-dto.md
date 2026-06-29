---
id: TASK-1218
title: Author ListObjectsQueryDto with z.coerce.number
story: STORY-0408
status: done
type: implementation
size: XS
---

## Description
Author the query-string DTO for the object listing endpoint. Use `z.coerce.number()` because Express delivers query parameters as strings.

## Files to create / modify
- `apps/backend/src/admin/objects/dto/list-objects-query.dto.ts` — new

## Implementation notes
- Verbatim from §5.4.3 (lines 7236–7243):
  ```ts
  export const ListObjectsQuerySchema = z.object({
    prefix: z.string().max(1024).optional(),
    delimiter: z.string().max(1).optional(),         // typically '/'
    marker: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
  });
  export class ListObjectsQueryDto extends createZodDto(ListObjectsQuerySchema) {}
  ```

## Acceptance criteria
- [ ] `limit` is coerced from string and defaults to 100.
- [ ] `limit < 1` or `> 1000` → schema rejection.
- [ ] `prefix` and `marker` cap at 1024 chars.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0413]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.4.3 (lines 7229–7246)
