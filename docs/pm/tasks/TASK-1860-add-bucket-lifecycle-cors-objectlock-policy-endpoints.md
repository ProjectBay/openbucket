---
id: TASK-1860
title: Add bucket lifecycle/CORS/object-lock/policy admin endpoints + DTOs
story: STORY-0612
status: done
type: implementation
size: M
---

## Description
Add the remaining bucket-config admin endpoints — lifecycle, CORS, object-lock configuration, and policy — adapting the existing `BucketService` domain methods to typed JSON. These back the Lifecycle/CORS/Policy tabs (STORY-0613). Lifecycle and CORS expose structured rule arrays; policy is opaque JSON stored verbatim; object-lock exposes the bucket's default-retention config.

## Files to create / modify
- `apps/openbucket-backend/src/admin/buckets/dto/lifecycle.dto.ts` — new (`LifecycleConfigDto { rules: LifecycleRuleDto[] }`, `LifecycleRuleDto` with `.meta({id:'LifecycleRuleDto'})`)
- `apps/openbucket-backend/src/admin/buckets/dto/cors.dto.ts` — new (`CorsConfigDto { rules: CorsRuleDto[] }`, `CorsRuleDto` with `.meta({id:'CorsRuleDto'})`)
- `apps/openbucket-backend/src/admin/buckets/dto/object-lock.dto.ts` — new (`ObjectLockConfigDto`)
- `apps/openbucket-backend/src/admin/buckets/dto/policy.dto.ts` — new (`BucketPolicyDto { policy: Record<string, unknown> }` or raw JSON passthrough)
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.controller.ts` — modify (add handlers)
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.controller.spec.ts` — modify (cases under [TASK-1866])

## Implementation notes
- Domain methods being adapted (verbatim, `bucket.service.ts`):
  - Lifecycle: `putLifecycle(req, bucket)` persists `parseLifecycleConfig(req.xmlBody)` (empty rule set → `MalformedXMLError`); `getLifecycle` → `NoSuchLifecycleConfigurationError` (404) when unset; `deleteLifecycle` clears + 204. The stored shape is `row.lifecycle` (the parsed rule array). The admin adapter takes/returns the rule array directly (the JSON DTO maps 1:1 to `row.lifecycle` entries).
  - CORS: `putCors` persists `parseCorsConfig(req.xmlBody)` → `row.cors`; `getCors` → `NoSuchCORSConfigurationError` (404) when empty; `deleteCors` clears + 204.
  - Object-lock: `putObjectLockConfig` persists `parseObjectLockConfig(req.xmlBody)` → `row.objectLock`; `getObjectLockConfig` → `ObjectLockConfigurationNotFoundError` (404) when `!row.objectLock?.enabled`. GET/PUT only (no DELETE — matches AC).
  - Policy: `putPolicy(req, bucket)` reads `req.rawBody`, `JSON.parse`, validates object → `row.policy` (`MalformedPolicyError` 400 on bad JSON); `getPolicy(_req, res, bucket)` writes the stored JSON verbatim, `NoSuchBucketPolicyError` (404) if none; `deletePolicy` clears + 204.
- For lifecycle/CORS/object-lock, adapt by loading the row and reading/writing the same columns the domain methods touch (avoid faking `req.xmlBody`); reuse the persisted column types from `@openbucket/persistence` so the DTO and storage stay aligned. For policy, accept a JSON object body and store it as `PolicyDocument` exactly like `putPolicy` does after `JSON.parse`.
- Routes: `GET|PUT|DELETE :name/lifecycle`; `GET|PUT|DELETE :name/cors`; `GET|PUT :name/object-lock`; `GET|PUT|DELETE :name/policy`.
- Globally-unique operationIds (method-name factory): `get/put/deleteBucketLifecycle`, `get/put/deleteBucketCors`, `get/putBucketObjectLock`, `get/put/deleteBucketPolicy`.
- Validation = **400 ValidationFailed** (`[[project_admin_api_spec_drift]]`). Malformed policy/lifecycle surface domain 400s.
- Audit: mutations emit a config-changed event (`bucket.lifecycle.changed` / `bucket.cors.changed` / `bucket.objectlock.changed` / `bucket.policy.changed`); confirm names against the `audit.service.ts` catalogue and extend the catalogue comment in [TASK-1864] if new.
- Decorators: `@ApiOperation({ operationId })` + `@ApiOkResponse({ type })`. DTOs via `createZodDto`; nested array item schemas carry `.meta({id})` so the array `$ref`s a named component (per `bucket-summary.dto.ts`).

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) lists all twelve ops; zero operationId collisions; `LifecycleRuleDto`/`CorsRuleDto` appear as named components (not inline `...Inner`).
- [ ] `nx test openbucket-backend --testPathPatterns=buckets-admin.controller.spec` (Node 20) passes ([TASK-1866]).
- [ ] PUT policy with non-JSON body → 400; GET cors on an unconfigured bucket → 404; GET object-lock when never enabled → 404.
- [ ] After [TASK-1865], `nx run api-client:check` is byte-equal.

## Test obligations
- Unit: covered by [TEST-0612] (via [TASK-1866]).
- E2E: covered by [TEST-0612].
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1859] (same controller file — land sequentially to avoid edit churn), [STORY-0612] deps ([EPIC-05])

## References
- UX review 2026-06-22 (power-user D — lifecycle/CORS/policy tabs; consumed by STORY-0613).
- `apps/openbucket-backend/src/domain/buckets/bucket.service.ts` (`get/put/deleteLifecycle`, `get/put/deleteCors`, `get/putObjectLockConfig`, `get/put/deletePolicy`), `s3/xml/s3-config-docs.ts` (parse helpers + persisted shapes), `admin/buckets/dto/bucket-summary.dto.ts` (`.meta({id})` pattern), `admin/audit/audit.service.ts`.
- See `[[project_admin_api_spec_drift]]`.
