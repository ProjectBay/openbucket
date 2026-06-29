---
id: TASK-1226
title: Implement ObjectsAdminController.meta with single decode
story: STORY-0410
status: done
type: implementation
size: S
---

## Description
Implement `GET /api/admin/buckets/:name/objects/:key(*)/meta`. Decodes `key` exactly once via `decodeURIComponent`, calls `ObjectService.head(bucket, key)`, returns `ObjectMetaDto` or 404.

## Files to create / modify
- `apps/backend/src/admin/objects/objects-admin.controller.ts` — modify (add `meta`)

## Implementation notes
- Verbatim from §5.6 (lines 7406–7426):
  ```ts
  @Get(':key(*)/meta')
  async meta(@Param('name') bucket: string, @Param('key') key: string): Promise<ObjectMetaDto> {
    const obj = await this.objects.head(bucket, decodeURIComponent(key));
    if (!obj) throw new NotFoundException();
    return {
      key: obj.key, bucket,
      size: obj.size, etag: obj.etag,
      contentType: obj.contentType, contentEncoding: obj.contentEncoding,
      lastModified: obj.lastModified.toISOString(),
      userMetadata: obj.userMetadata, tagging: obj.tagging,
      versionId: obj.versionId, storageClass: obj.storageClass,
    };
  }
  ```
- The `:key(*)` wildcard captures slash-bearing keys; the SPA encodes once (§5.13). Double-decoding is forbidden.

## Acceptance criteria
- [ ] Returns 200 with `ObjectMetaDto` on hit.
- [ ] Returns 404 on miss.
- [ ] Key with `%2F` survives as a literal `/` in storage (single decode only).

## Test obligations
- Unit: covered by [TEST-0412]
- E2E: covered by [TEST-0413]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1225]

## References
- `docs/WHITEPAPER.md` §5.6 (lines 7406–7448)
