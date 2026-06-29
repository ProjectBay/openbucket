---
id: TASK-1861
title: Add object versions + tagging admin endpoints + DTOs
story: STORY-0612
status: done
type: implementation
size: M
---

## Description
Add admin endpoints for per-object version listing and object tagging, adapting `BucketService.listObjectVersions` and `ObjectService` tagging methods to JSON. The object key may contain `/` and is read from the raw request path and decoded exactly once — reuse the existing `rawTail`/`decodeOnce` helpers already in `objects-admin.controller.ts`. Sub-resources are selected by query flag (`?versions`, `?tagging`) to match the existing object GET dispatch style.

## Files to create / modify
- `apps/openbucket-backend/src/admin/objects/dto/object-versions-response.dto.ts` — new (`ObjectVersionsResponseDto`; nested `ObjectVersionDto` + `DeleteMarkerDto` with `.meta({id})`)
- `apps/openbucket-backend/src/admin/objects/dto/object-tagging.dto.ts` — new (`ObjectTaggingDto { tags: Record<string,string> }`)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.ts` — modify (add version-list + tagging handlers)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.spec.ts` — modify (cases under [TASK-1866])

## Implementation notes
- Domain methods being adapted (verbatim):
  - Versions: `BucketService.listObjectVersions(req: Request, bucket: string): Promise<unknown>` reads `req.query` (`prefix`, `key-marker`, `version-id-marker`, `max-keys`) and returns the S3 POJO `{ __root:'ListVersionsResult', Version:[...], DeleteMarker:[...], IsTruncated, ... }`. The admin adapter takes typed query params and maps `Version`/`DeleteMarker` → a JSON `{ versions[], deleteMarkers[], isTruncated, nextKeyMarker?, nextVersionIdMarker? }`. Avoid faking `req`; if a clean HTTP-agnostic seam is needed, add one beside the §5.5 admin block in `bucket.service.ts` calling `objects.listVersionsByPrefix(...)` directly.
  - Tagging: `ObjectService.putTagging(req, bucket, key)` persists `parseTagSet(req.xmlBody)` on the current version; `getTagging(_req, res, bucket, key)` writes a `<Tagging>` XML doc (empty TagSet → 200, never 404 for objects); `deleteTagging` clears + 204. The admin adapter accepts/returns `{ tags: Record<string,string> }` and reads/writes `obj.tagging` (load via `objects.findCurrentVersion(bucket, key)`; `NoSuchKeyError` 404 when absent). Do NOT reuse the `@Res()` XML writer — return the JSON DTO.
- Routes (query-flag sub-resources on the existing `*` key route family):
  - `GET /api/admin/buckets/:name/objects/*?versions` → version list (note: scoped to the prefix == the key path; for a bucket-wide listing pass the prefix).
  - `GET|PUT|DELETE /api/admin/buckets/:name/objects/*?tagging`.
  - Because the existing `@Get('*')`/`@Put('*')`/`@Delete('*')` handlers already own these routes, branch inside them on `'versions' in req.query` / `'tagging' in req.query` (mirroring the existing `'content' in req.query` branch), OR add dedicated handlers if path-to-regexp 8 permits a distinct route. Document the chosen approach in the controller.
- Globally-unique operationIds (method-name factory): `listObjectVersions` (no admin op exists yet with this name — confirm it does not collide with the S3 controllers, which are excluded from the export), `getObjectTagging`/`putObjectTagging`/`deleteObjectTagging`. Use the `Object` prefix to stay distinct from the bucket tagging ops in [TASK-1859].
- Validation = **400 ValidationFailed**. Tag map via `z.record(z.string(), z.string())`, `.strict()` body.
- Audit: tagging mutations emit `object.tagging.changed` (`{ subject, bucket, key }`) — confirm/extend the catalogue in [TASK-1864]. Version listing is read-only → no audit.
- Decorators: `@ApiOperation({ operationId })` + `@ApiParam({ name:'path', ... })` (key may contain `/`) + `@ApiOkResponse({ type })`.

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) lists `listObjectVersions`, `get/put/deleteObjectTagging`; zero operationId collisions; version item schemas are named components.
- [ ] `nx test openbucket-backend --testPathPatterns=objects-admin.controller.spec` (Node 20) passes ([TASK-1866]).
- [ ] Listing versions of a versioned bucket returns both versions and delete markers; a slash-bearing key (`a/b/c.txt`) tags correctly (decoded once).
- [ ] After [TASK-1865], `nx run api-client:check` is byte-equal.

## Test obligations
- Unit: covered by [TEST-0612] (via [TASK-1866]).
- E2E: covered by [TEST-0612].
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1858] (same controller file — land sequentially), [STORY-0612] deps ([EPIC-05])

## References
- UX review 2026-06-22 (power-user — object versions + tags).
- `apps/openbucket-backend/src/domain/buckets/bucket.service.ts` (`listObjectVersions`, `objects.listVersionsByPrefix`), `domain/objects/object.service.ts` (`putTagging`/`getTagging`/`deleteTagging`, `findCurrentVersion`), `admin/objects/objects-admin.controller.ts` (`rawTail`/`decodeOnce`, the `'content' in req.query` branch), `admin/audit/audit.service.ts`.
- See `[[project_admin_api_spec_drift]]`.
