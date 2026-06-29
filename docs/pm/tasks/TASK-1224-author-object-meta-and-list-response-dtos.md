---
id: TASK-1224
title: Author ListObjectsResponseDto and ObjectMetaDto
story: STORY-0410
status: done
type: implementation
size: XS
---

## Description
Author the two response DTOs for the object browser endpoints.

## Files to create / modify
- `apps/backend/src/admin/objects/dto/list-objects-response.dto.ts` — new
- `apps/backend/src/admin/objects/dto/object-meta.dto.ts` — new

## Implementation notes
- `ListObjectsResponseDto` shape (from §5.6 controller return type, lines 7388–7404):
  ```ts
  export const ListObjectsResponseSchema = z.object({
    bucket: z.string(),
    prefix: z.string(),
    delimiter: z.string().optional(),
    marker: z.string().optional(),
    nextMarker: z.string().optional(),
    isTruncated: z.boolean(),
    contents: z.array(z.object({
      key: z.string(),
      size: z.number().int().nonnegative(),
      etag: z.string(),
      lastModified: z.string().datetime(),
      storageClass: z.string(),
    })),
    commonPrefixes: z.array(z.string()),
  });
  ```
- `ObjectMetaDto` shape (from §5.6 lines 7413–7425):
  ```ts
  export const ObjectMetaSchema = z.object({
    key: z.string(),
    bucket: z.string(),
    size: z.number().int().nonnegative(),
    etag: z.string(),
    contentType: z.string().optional(),
    contentEncoding: z.string().optional(),
    lastModified: z.string().datetime(),
    userMetadata: z.record(z.string()),
    tagging: z.record(z.string()),
    versionId: z.string().optional(),
    storageClass: z.string(),
  });
  ```

## Acceptance criteria
- [ ] Both DTOs extend `createZodDto`.
- [ ] Shapes match the controller return types verbatim from §5.6.

## Test obligations
- Unit: covered by [TEST-0409]
- E2E: covered by [TEST-0413]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.6 (lines 7388–7425)
