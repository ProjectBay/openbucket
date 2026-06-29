---
id: TASK-1225
title: Implement ObjectsAdminController.list with prefix/marker pagination
story: STORY-0410
status: done
type: implementation
size: S
---

## Description
Implement `GET /api/admin/buckets/:name/objects`. Validates `ListObjectsQueryDto`, delegates to `ObjectService.list`, returns `ListObjectsResponseDto`.

## Files to create / modify
- `apps/backend/src/admin/objects/objects-admin.controller.ts` — new (skeleton + `list`)

## Implementation notes
- Controller prefix `@Controller('api/admin/buckets/:name/objects')`.
- Verbatim from §5.6 (lines 7376–7404):
  ```ts
  @Get()
  async list(@Param('name') bucket: string, @Query() q: ListObjectsQueryDto): Promise<ListObjectsResponseDto> {
    const page = await this.objects.list({
      bucket, prefix: q.prefix, delimiter: q.delimiter, marker: q.marker, limit: q.limit,
    });
    return {
      bucket,
      prefix: q.prefix ?? '',
      delimiter: q.delimiter,
      marker: q.marker,
      nextMarker: page.nextMarker,
      isTruncated: page.isTruncated,
      contents: page.contents.map((o) => ({
        key: o.key, size: o.size, etag: o.etag,
        lastModified: o.lastModified.toISOString(),
        storageClass: o.storageClass,
      })),
      commonPrefixes: page.commonPrefixes,
    };
  }
  ```
- Add `@ApiOperation({ operationId: 'listObjects' })`.

## Acceptance criteria
- [ ] Returns `ListObjectsResponseDto` with `contents`, `commonPrefixes`, `isTruncated`, `nextMarker`.
- [ ] `prefix` defaults to empty string in the response when omitted from the query.
- [ ] Truncated listings carry `nextMarker` for client-side pagination.

## Test obligations
- Unit: covered by [TEST-0412]
- E2E: covered by [TEST-0413]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1218], [TASK-1224]

## References
- `docs/WHITEPAPER.md` §5.6 (lines 7376–7404)
