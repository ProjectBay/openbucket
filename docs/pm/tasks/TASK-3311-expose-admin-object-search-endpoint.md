---
id: TASK-3311
title: Expose the admin object-search endpoint and DTOs
story: STORY-1101
status: backlog
type: implementation
size: M
---

## Description

Add the cross-bucket search HTTP surface: a new `GET /api/admin/objects/search`
route on a dedicated controller, a `search()` method on `ObjectService` that
adapts `ObjectRepository.searchAcrossBuckets` into clean serializable rows +
opaque cursor, and the request/response DTOs via `nestjs-zod`. The endpoint
inherits the global `JwtAuthGuard` + `ThrottlerGuard` and emits an audit event.

## Files to create / modify

- `libs/nestjs/src/lib/admin/objects/objects-search-admin.controller.ts` — new
- `libs/nestjs/src/lib/admin/objects/dto/object-search-query.dto.ts` — new
- `libs/nestjs/src/lib/admin/objects/dto/object-search-response.dto.ts` — new
- `libs/nestjs/src/lib/admin/objects/objects-admin.module.ts` — modify (register
  the new controller alongside `ObjectsAdminController`)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (add `search()`
  + `ObjectSearchInput`/`ObjectSearchResult` interfaces + cursor codec)
- `libs/nestjs/src/lib/admin/objects/objects-search-admin.controller.spec.ts` — new

## Implementation notes

- Route placement: put `search` on its OWN controller at `api/admin/objects` — it
  is cross-bucket, so it must not sit under `api/admin/buckets/:name/objects`
  (whose `@Get('*')` key catch-all would otherwise swallow it). Because it is
  registered in `objects-admin.module.ts` (already imported by `AdminModule`), it
  inherits the `APP_GUARD` `JwtAuthGuard` and `ThrottlerGuard` `default` bucket
  (100/min/IP) with no extra wiring — do not add a bespoke guard (EPIC-08
  posture; no policy-evaluator on the admin plane).

- Query DTO (`z.coerce` for numbers — Express delivers strings, matching
  `list-objects-query.dto.ts`):

  ```ts
  export const ObjectSearchQuerySchema = z.object({
    q: z.string().min(1).max(1024),
    mode: z.enum(['prefix', 'contains']).default('prefix'),
    bucket: z.string().max(255).optional(),
    tagKey: z.string().max(128).optional(),
    tagValue: z.string().max(256).optional(),
    cursor: z.string().max(4096).optional(),   // opaque base64url
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).refine((v) => v.mode !== 'contains' || v.q.trim().length >= 2, {
    message: 'contains mode requires q of length >= 2', path: ['q'],
  }).refine((v) => (v.tagKey === undefined) === (v.tagValue === undefined), {
    message: 'tagKey and tagValue must be provided together', path: ['tagValue'],
  });
  ```

  The `min 2` refinement on `contains` is a DoS guard against `%%` full-table
  scans; `tagKey`/`tagValue` are wired in [TASK-3312] but declared here so the DTO
  is stable for the client regen.

- Response DTO: reuse the `.meta({ id })` component pattern from
  `list-objects-response.dto.ts` so the generated client emits a shared model:

  ```ts
  export const ObjectSearchHitSchema = z.object({
    bucket: z.string(), key: z.string(), size: z.number().int().nonnegative(),
    etag: z.string(), lastModified: z.string().datetime(),
    storageClass: z.string(), contentType: z.string().optional(),
  }).meta({ id: 'ObjectSearchHit' });

  export const ObjectSearchResponseSchema = z.object({
    results: z.array(ObjectSearchHitSchema),
    isTruncated: z.boolean(),
    nextCursor: z.string().optional(),
  });
  ```

- Cursor codec (in `object.service.ts`): opaque, tamper-tolerant, NOT sensitive —
  `base64url(JSON.stringify({ b, k }))` where `b`=bucket, `k`=key of the last row.
  On decode, `try/catch` → treat a malformed cursor as "no cursor" (start from the
  top) rather than 500. Never trust the cursor for authz (there is none beyond the
  admin JWT); it only positions the keyset.

- Controller sketch:

  ```ts
  @Controller('api/admin/objects')
  export class ObjectsSearchAdminController {
    @Get('search')
    @ApiOperation({ operationId: 'searchObjects' })
    @ApiOkResponse({ type: ObjectSearchResponseDto })
    async search(@Query() q: ObjectSearchQueryDto, @Req() req: Request): Promise<ObjectSearchResponseDto> {
      const page = await this.objects.search({ ...q });
      this.audit.emit({ event: 'object.searched', subject: req.user.username,
        mode: q.mode, hasTag: q.tagKey !== undefined, count: page.results.length,
        requestId: req.openbucket.requestId });
      return page;
    }
  }
  ```

  Audit records the shape of the search (mode, whether a tag filter was used,
  result count) — NOT the raw `q` term, to avoid logging potentially sensitive
  key fragments. Provide `AuditService` locally as `objects-admin.module.ts`
  already does.

- `ObjectService.search` maps `AdminObjectListItem`-style rows: `key`, `size`
  (Number the `bigint`), `etag`, `lastModified` (`modifiedAt`), `storageClass`,
  `contentType`, and `bucket` from `row.bucket.name`. Returns raw keys — the
  console is responsible for encoding-once when building browser/download links
  (mirrors the `decodeOnce`/`rawTail` contract in `objects-admin.controller.ts`).

## Acceptance criteria

- [ ] `GET /api/admin/objects/search?q=a&mode=prefix` returns
      `{ results, isTruncated, nextCursor? }` with cross-bucket hits ordered by
      `(bucket, key)`.
- [ ] Omitting the bearer token yields `401` (global `JwtAuthGuard`), and >100
      calls/min from one IP yield `429` (`default` throttle bucket).
- [ ] `mode=contains&q=a` (1 char) yields `400` from the zod refinement; `limit=500`
      is clamped to `100`.
- [ ] A malformed `cursor` does not 500 — it restarts from the first page.
- [ ] The exported OpenAPI (`nx run openbucket-backend:openapi:export`) contains an
      operation with `operationId: searchObjects` and the `ObjectSearchHit` schema.
- [ ] `nx test nestjs --testPathPattern=objects-search-admin.controller.spec` passes.

## Test obligations

- Unit: covered by [TEST-1101] (cases 4, 6, 7)
- E2E: covered by [TEST-1101] (case 5)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3310]

## References

- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts`,
  `…/objects-admin.module.ts`, `…/dto/list-objects-query.dto.ts`,
  `…/dto/list-objects-response.dto.ts`
- `libs/nestjs/src/lib/admin/admin.module.ts` (`APP_GUARD` JwtAuthGuard +
  ThrottlerGuard, `default` bucket)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` (`AdminObjectListItem`,
  `AdminObjectListPage`), `libs/nestjs/src/lib/admin/audit/audit.service.ts`
