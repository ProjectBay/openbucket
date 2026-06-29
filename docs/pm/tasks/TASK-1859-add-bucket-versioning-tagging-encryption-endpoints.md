---
id: TASK-1859
title: Add bucket versioning/tagging/encryption admin endpoints + DTOs
story: STORY-0612
status: done
type: implementation
size: M
---

## Description
Add JSON admin endpoints for the three most-used bucket config features — versioning, tagging, and default (SSE-S3) encryption — adapting the existing `BucketService` domain methods. The domain methods today take `(req, bucket)` and read/write XML via `req.xmlBody`; the admin adapters take typed JSON DTOs instead, so the SPA never speaks XML. Bucket config is stored on the `Bucket` row by the domain layer; these endpoints read/write the same columns.

## Files to create / modify
- `apps/openbucket-backend/src/admin/buckets/dto/versioning.dto.ts` — new (`VersioningConfigDto { status: 'Enabled' | 'Suspended' }`)
- `apps/openbucket-backend/src/admin/buckets/dto/tagging.dto.ts` — new (`TaggingDto { tags: Record<string,string> }`)
- `apps/openbucket-backend/src/admin/buckets/dto/encryption.dto.ts` — new (`EncryptionConfigDto { algorithm: 'AES256' }`)
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.controller.ts` — modify (add the handlers)
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.controller.spec.ts` — modify (cases under [TASK-1866])

## Implementation notes
- Domain methods being adapted (verbatim signatures from `bucket.service.ts`):
  - Versioning: `putVersioning(req: Request, bucket: string)` reads `req.xmlBody.VersioningConfiguration.Status` (`'Enabled' | 'Suspended'`; never back to Disabled); `getVersioning(_req, bucket)` returns `{ Status }` or empty. The admin adapter should NOT fake `req.xmlBody`; instead expose a thin domain method or load the row and set `row.versioning = VersioningState.Enabled|Suspended` then `persistAndFlush` — mirror the exact branch logic in `putVersioning`. If adding a domain method, follow the existing clean `create`/`deleteByName` admin-domain seam in `bucket.service.ts` (§5.5 block).
  - Tagging: `putTagging` persists `row.tagging = parseTagSet(req.xmlBody)`; `getTagging` throws `NoSuchTagSetError` (404) when empty; `deleteTagging` clears + 204. Admin adapter accepts/returns `{ tags: Record<string,string> }` and persists `row.tagging` directly.
  - Encryption: `putEncryption` accepts only `AES256` (else `InvalidArgumentError` → 400); `getEncryption` throws `ServerSideEncryptionConfigurationNotFoundError` (404) when unset; `deleteEncryption` clears + 204.
- Routes: `PUT /api/admin/buckets/:name/versioning`; `GET|PUT|DELETE /api/admin/buckets/:name/tagging`; `GET|PUT|DELETE /api/admin/buckets/:name/encryption`. (DELETE versioning is intentionally absent — S3 has no transition back to Disabled.)
- Globally-unique operationIds (method-name-only factory): `putBucketVersioning`, `getBucketTagging`/`putBucketTagging`/`deleteBucketTagging`, `getBucketEncryption`/`putBucketEncryption`/`deleteBucketEncryption`. The `Bucket` prefix is required — bare `getTagging`/`putTagging`/`getEncryption` collide with the object-level ops in [TASK-1861]/[TASK-1862] and the object service.
- Validation = **400 ValidationFailed** (per `[[project_admin_api_spec_drift]]`), not 422. Encryption algorithm other than `AES256` surfaces the domain `InvalidArgument` (400).
- Audit on mutations: versioning emits `bucket.versioning.changed` with `{ subject, bucket, from, to }` (catalogue requires `from`/`to`); tagging/encryption mutations may emit `bucket.versioning.changed`'s sibling — if no catalogue event exists for tagging/encryption, add `bucket.tagging.changed`/`bucket.encryption.changed` and note them in the audit catalogue comment in [TASK-1864]. Read `audit.service.ts` catalogue table first.
- Decorators: `@ApiOperation({ operationId })` + `@ApiOkResponse({ type })` on each; DTOs via `createZodDto` over plain `zod` `.strict()` schemas; nested `Record<string,string>` tag maps use `z.record(z.string(), z.string())`.

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) lists `putBucketVersioning`, `get/put/deleteBucketTagging`, `get/put/deleteBucketEncryption`; zero operationId collisions.
- [ ] `nx test openbucket-backend --testPathPatterns=buckets-admin.controller.spec` (Node 20) passes with the new cases ([TASK-1866]).
- [ ] PUT encryption with `algorithm:'aws:kms'` → 400 ValidationFailed (or domain `InvalidArgument` 400); GET tagging on an untagged bucket → 404.
- [ ] After [TASK-1865], `nx run api-client:check` is byte-equal.

## Test obligations
- Unit: covered by [TEST-0612] (via [TASK-1866]).
- E2E: covered by [TEST-0612].
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0612] deps ([EPIC-05] shipped versioning/tagging/encryption domain methods)

## References
- UX review 2026-06-22 (power-user D — versioning/tags/encryption tabs; consumed by STORY-0613).
- `apps/openbucket-backend/src/domain/buckets/bucket.service.ts` (`putVersioning`/`getVersioning`, `putTagging`/`getTagging`/`deleteTagging`, `putEncryption`/`getEncryption`/`deleteEncryption`, `VersioningState`), `admin/buckets/dto/create-bucket.dto.ts` (createZodDto pattern), `admin/audit/audit.service.ts`.
- See `[[project_admin_api_spec_drift]]`: validation = 400 ValidationFailed; admin thin controllers may need a domain method EPIC-03/05 never shipped (HTTP-agnostic seam).
