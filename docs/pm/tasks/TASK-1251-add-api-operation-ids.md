---
id: TASK-1251
title: Add @ApiOperation operationIds to bucket controller methods
story: STORY-0417
status: review
type: implementation
size: XS
---

## Description
Decorate the four `BucketsAdminController` handlers with `@ApiOperation({ operationId: '...' })` so openapi-generator emits readable method names (`listBuckets`, `createBucket`, `getBucket`, `deleteBucket`) instead of the default `bucketsAdminControllerList` etc.

## Files to create / modify
- `apps/backend/src/admin/buckets/buckets-admin.controller.ts` — modify

## Implementation notes
- Per §5.13 (line 8159): "use `@nestjs/swagger`'s `@ApiOperation({ operationId: 'listBuckets' })` on each handler — the generator picks up `operationId` and produces `bucketsService.listBuckets()` instead."
- Pair each handler with its target operationId:
  - `list` → `'listBuckets'`
  - `create` → `'createBucket'`
  - `get` → `'getBucket'`
  - `delete` → `'deleteBucket'`

## Acceptance criteria
- [ ] All four bucket controller methods have `@ApiOperation({ operationId: '...' })` set.
- [ ] Generated client (when EPIC-06 runs) emits methods `listBuckets`, `createBucket`, `getBucket`, `deleteBucket`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0411] (operation IDs surface in the OpenAPI document)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1222]

## References
- `docs/WHITEPAPER.md` §5.13 (lines 8158–8160)
