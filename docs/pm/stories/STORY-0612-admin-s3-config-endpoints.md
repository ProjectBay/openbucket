---
id: STORY-0612
title: Admin REST endpoints for the S3 config surface + client regeneration
epic: EPIC-07
status: done
size: L
risk: medium
---

## User story
As a developer, I want thin admin JSON endpoints over the S3 config the domain already implements (versioning, tagging, encryption, lifecycle, CORS, bulk delete, object versions/retention, presign), so the SPA can manage these features without speaking the raw S3 protocol.

## Description
The S3 domain services implement the full config surface (`BucketService` versioning/tagging/CORS/lifecycle/object-lock/encryption/policy/bulkDelete/listObjectVersions; `ObjectService` tagging/retention/legal-hold/copy), but the admin controllers expose only buckets/objects/keys CRUD. Add thin adapter endpoints (the project's established "thin controller" pattern), DTOs (nestjs-zod `createZodDto` + `@ApiOkResponse` for clean codegen per STORY-0500), audit events on mutations, then regenerate `@openbucket/api-client`. This unlocks the feature-UI stories (0604/0613/0614/0615).

## Acceptance criteria
- [ ] `POST /api/admin/buckets/:name/objects:batchDelete` (`BulkDeleteDto {keys[]}`) → `BucketService.bulkDelete`; returns `{deleted[], errors[]}`.
- [ ] Bucket config endpoints: `PUT :name/versioning`; `GET/PUT/DELETE :name/tagging`, `:name/encryption`, `:name/lifecycle`, `:name/cors`; `GET/PUT :name/object-lock`; `GET/PUT/DELETE :name/policy`.
- [ ] Object endpoints: `GET :name/objects/*?versions` → `listObjectVersions`; `GET/PUT/DELETE :name/objects/*?tagging`; `GET/PUT :name/objects/*?retention` & `?legal-hold`.
- [ ] Presign: `POST :name/objects/*:presign` (`{expiresIn}`) → SigV4 query-signed URL (reuse `presigned.ts`/canonical-request) → `PresignedUrlDto {url, expiresAt}` (capped at `MAX_EXPIRES`).
- [ ] All mutations emit `audit.emit(...)`; each method has `@ApiOperation({operationId})` + `@ApiOkResponse({type})`; DTOs are `createZodDto`; `nx run openbucket-backend:openapi:export` lists every new operation with zero operationId collisions.
- [ ] `@openbucket/api-client` regenerated; `api-client:check` byte-equal (STORY-0500 gate green).

## Tasks
- [TASK-1858] Add `BulkDeleteDto` + `:batchDelete` to `objects-admin.controller.ts` → `BucketService.bulkDelete`.
- [TASK-1859] Add bucket versioning/tagging/encryption endpoints + DTOs to `buckets-admin.controller.ts`.
- [TASK-1860] Add bucket lifecycle/CORS/object-lock/policy endpoints + DTOs.
- [TASK-1861] Add object versions + tagging endpoints to `objects-admin.controller.ts`.
- [TASK-1862] Add object retention + legal-hold endpoints.
- [TASK-1863] Add the presign generator endpoint (reuse `s3/sigv4/presigned.ts` signing) + `PresignedUrlDto`.
- [TASK-1864] `@ApiOperation`/`@ApiOkResponse` + audit events on all of the above; register modules.
- [TASK-1865] `nx run openbucket-backend:openapi:export`; regenerate the client (`api-client:generate`); commit.
- [TASK-1866] Backend unit specs for each new controller method (thin-adapter mapping + audit).

## Test plan
- [TEST-0612] Unit (controller adapters + audit) + e2e: each endpoint round-trips against the booted app; bulk delete returns deleted/errors; presign URL verifies via the existing SigV4 verifier; OpenAPI export + client freshness green.

## Dependencies
- Blocks: [STORY-0604] (batch-delete), [STORY-0613], [STORY-0614], [STORY-0615]
- Blocked by: [EPIC-05], [EPIC-06]

## References
- UX review 2026-06-22 (power-user feature-gap table; cross-cutting admin-API notes).
- `apps/openbucket-backend/src/admin/{buckets,objects}/**`, `domain/buckets/bucket.service.ts`, `domain/objects/object.service.ts`, `s3/sigv4/presigned.ts`, `libs/api-client/**`.
- See `[[project_admin_api_spec_drift]]`: validation = 400 ValidationFailed; thin controllers adapt existing domain methods.
