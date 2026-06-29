---
id: TASK-1864
title: Finalize `@ApiOperation`/`@ApiOkResponse` + audit events + module registration
story: STORY-0612
status: done
type: implementation
size: S
---

## Description
Cross-cutting pass over all the new endpoints from [TASK-1858..1863]: ensure every new handler carries `@ApiOperation({ operationId })` + `@ApiOkResponse({ type })` (clean codegen per STORY-0500), every mutation emits an `audit.emit(...)` with a catalogued event name, and the admin modules wire up any new providers/DTOs so the controllers resolve at boot. This is the consistency/registration gate before the OpenAPI export + client regen in [TASK-1865].

## Files to create / modify
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.controller.ts` — modify (audit emits + decorators sweep)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.ts` — modify (audit emits + decorators sweep)
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.module.ts` — modify only if a new domain seam/provider is added (controllers already import `DomainModule` + provide `AuditService`)
- `apps/openbucket-backend/src/admin/objects/objects-admin.module.ts` — modify only if presign needs `KeyService`/`Sigv4Verifier` providers wired (add the SigV4 providers/module the presign generator depends on)
- `apps/openbucket-backend/src/admin/audit/audit.service.ts` — modify (extend the v1 event catalogue comment with the new `bucket.*`/`object.*` events)

## Implementation notes
- Export uses `operationIdFactory: (_controllerKey, methodKey) => methodKey` (see `openapi-export.ts`) — operationIds are the **method name only**, so they must be globally unique across BOTH admin controllers. Audit the final method names: bucket-scope ops carry a `Bucket` token, object-scope ops carry an `Object` token (e.g. `getBucketTagging` vs `getObjectTagging`) to prevent collisions. The export must finish with zero duplicate-operationId warnings.
- Every method needs `@ApiOperation({ operationId })`; non-204 methods need `@ApiOkResponse({ type })` (or `@ApiNoContentResponse()` / `@HttpCode(204)` for deletes). This drives `withInterfaces=true` codegen — missing response types produce `any`-typed client methods.
- Audit: every mutation (`PUT`/`POST`/`DELETE`/batch) emits `audit.emit({ event, subject: req.user.username, ...fields, requestId: req.openbucket.requestId })`. Read-only `GET` is NOT audited (per `audit.service.ts` policy). The `AdminPrincipal`/`req.user.username` + `req.openbucket.requestId` access pattern matches the existing `createBucket`/`deleteObject` handlers.
- Update the `audit.service.ts` catalogue table comment with the new events introduced across [TASK-1859..1863] (`bucket.tagging.changed`, `bucket.encryption.changed`, `bucket.lifecycle.changed`, `bucket.cors.changed`, `bucket.objectlock.changed`, `bucket.policy.changed`, `object.tagging.changed`, `object.retention.changed`, `object.legalhold.changed`, `object.presigned`) so callers and downstream indexing stay aligned. `bucket.versioning.changed` already exists.
- Module registration: `BucketsAdminModule`/`ObjectsAdminModule` already `imports: [DomainModule]` + `providers: [AuditService]`. The presign generator ([TASK-1863]) needs the SigV4 `KeyService` (+ verifier for the round-trip test) — import the module that provides them (the S3 SigV4 module) into `ObjectsAdminModule`, or expose the generator as a domain seam already in `DomainModule`. Confirm the app boots (`nx serve` health-poll) — guard against the value-import boot hang in `[[project_webpack_import_type_boot_hang]]` by using `import type` for any interface pulled from a DI-cycle module.

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) succeeds with zero duplicate-operationId warnings; every new path has an `operationId` and a non-`any` response schema (or 204).
- [ ] `nx test openbucket-backend` (Node 20) passes (controller specs + any module-resolution spec).
- [ ] App boots (`dist/main.js` health-poll green per the boot-flake/import-hang memory) with the new modules registered.
- [ ] `audit.service.ts` catalogue comment lists every new event name.

## Test obligations
- Unit: covered by [TEST-0612] (audit assertions per method).
- E2E: covered by [TEST-0612] (boot + route resolution).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1858], [TASK-1859], [TASK-1860], [TASK-1861], [TASK-1862], [TASK-1863]

## References
- `apps/openbucket-backend/src/openapi-export.ts` (`operationIdFactory` method-name-only), `admin/audit/audit.service.ts` (event catalogue), `admin/{buckets,objects}/*-admin.module.ts`, `s3/sigv4/*` (KeyService/Sigv4Verifier providers).
- STORY-0500 (clean-codegen decorators gate). See `[[project_admin_api_spec_drift]]`, `[[project_webpack_import_type_boot_hang]]`, `[[project_m6_openapi_and_env]]`.
