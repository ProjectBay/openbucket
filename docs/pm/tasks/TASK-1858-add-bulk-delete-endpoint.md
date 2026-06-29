---
id: TASK-1858
title: Add `BulkDeleteDto` + `:batchDelete` to the objects-admin controller
story: STORY-0612
status: done
type: implementation
size: S
---

## Description
Add a JSON bulk-delete endpoint to the admin object surface that adapts the existing `BucketService.bulkDelete` domain method. The S3 wire path takes a `<Delete>` XML body and writes a `<DeleteResult>` POJO via `res`; the admin endpoint instead takes a `{keys[]}` JSON body and returns a clean `{deleted[], errors[]}` JSON shape. No new domain logic — this is the established thin-controller adapter pattern.

## Files to create / modify
- `apps/openbucket-backend/src/admin/objects/dto/bulk-delete.dto.ts` — new (`BulkDeleteDto`)
- `apps/openbucket-backend/src/admin/objects/dto/bulk-delete-response.dto.ts` — new (`BulkDeleteResponseDto`, with `.meta({id})` on the nested deleted/error item schemas)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.ts` — modify (add `batchDelete` handler)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.spec.ts` — modify (cases covered under [TASK-1866])

## Implementation notes
- Domain method being adapted (verbatim signature):
  `async bulkDelete(res: Response, bucket: string, entries: DeleteEntry[], quiet: boolean): Promise<unknown>` where `interface DeleteEntry { key: string; versionId?: string }`. It returns the S3 POJO `{ __root: 'DeleteResult', Deleted: [...], Error: [...] }`.
- The domain method writes to `res` and returns the S3-shaped POJO. The admin adapter must NOT reuse that req/res signature directly; instead iterate `ObjectService.deleteOne(bucket, key, versionId)` (the same seam `bulkDelete` uses) and map to the JSON DTO, OR call `bulkDelete` with a stub `Response` and re-map `Deleted`/`Error` → `deleted`/`errors`. Prefer iterating `deleteOne` so the controller stays HTTP-agnostic and testable without a `res` double.
- Route: `POST /api/admin/buckets/:name/objects:batchDelete`. The `:batchDelete` action suffix avoids colliding with the `@Post()`-less object controller and the `*` key routes. Confirm path-to-regexp 8 (Express 5) accepts the literal `:batchDelete` suffix on the `:name` segment; if not, mount it as `@Post('batch-delete')` on the controller and note the final path in AC.
- DTO shape: `BulkDeleteDto { keys: { key: string; versionId?: string }[] }` (`.strict()`, `keys` min 1, cap at 1000 to mirror S3). Response: `BulkDeleteResponseDto { deleted: { key, versionId? }[]; errors: { key, versionId?, code, message }[] }`.
- `operationId` must be globally unique across the admin surface (the export uses `operationIdFactory: (_controllerKey, methodKey) => methodKey` — method name only, no controller prefix). Use `batchDeleteObjects`.
- Audit: emit `audit.emit({ event: 'object.deleted', subject: req.user.username, bucket, key, requestId: req.openbucket.requestId })` once per successfully-deleted key (the existing `object.deleted` catalogue event; see `audit.service.ts`).
- Decorators: `@ApiOperation({ operationId: 'batchDeleteObjects' })` + `@ApiOkResponse({ type: BulkDeleteResponseDto })`. DTOs via `createZodDto` (plain `zod`, not `nestjs-zod/z`).

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) lists the `batchDeleteObjects` operation; zero operationId collisions (export succeeds, no duplicate-operationId warning).
- [ ] `nx test openbucket-backend --testPathPatterns=objects-admin.controller.spec` (Node 20) passes, including the new `batchDelete` cases from [TASK-1866].
- [ ] Posting `{keys:[{key:'a'},{key:'missing'}]}` returns `{deleted:[...], errors:[...]}`; one `object.deleted` audit per deleted key.
- [ ] After [TASK-1865], `nx run api-client:check` is byte-equal (no stale diff).

## Test obligations
- Unit: covered by [TEST-0612] (controller adapter mapping + audit; via [TASK-1866]).
- E2E: covered by [TEST-0612] (round-trip against the booted app).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0612] deps ([EPIC-05], [EPIC-06] — `bulkDelete`/`deleteOne` already shipped)

## References
- UX review 2026-06-22 (power-user feature-gap table — batch delete; unblocks STORY-0604).
- `apps/openbucket-backend/src/domain/buckets/bucket.service.ts` (`bulkDelete`, `DeleteEntry`), `domain/objects/object.service.ts` (`deleteOne`), `admin/objects/objects-admin.controller.ts`, `admin/objects/dto/*.dto.ts`, `admin/audit/audit.service.ts`.
- See `[[project_admin_api_spec_drift]]`: validation = 400 ValidationFailed; thin controllers adapt existing domain methods.
