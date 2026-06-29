---
id: TASK-1862
title: Add object retention + legal-hold admin endpoints + DTOs
story: STORY-0612
status: done
type: implementation
size: S
---

## Description
Add admin endpoints for per-object retention and legal-hold, adapting the existing `ObjectService` object-lock methods to JSON. These let the SPA read/set WORM controls on individual object versions without speaking the S3 `?retention` / `?legal-hold` XML sub-resources.

## Files to create / modify
- `apps/openbucket-backend/src/admin/objects/dto/retention.dto.ts` — new (`RetentionDto { mode: 'GOVERNANCE' | 'COMPLIANCE'; retainUntil: string }`)
- `apps/openbucket-backend/src/admin/objects/dto/legal-hold.dto.ts` — new (`LegalHoldDto { status: 'ON' | 'OFF' }`)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.ts` — modify (add retention + legal-hold handlers)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.spec.ts` — modify (cases under [TASK-1866])

## Implementation notes
- Domain methods being adapted (verbatim, `object.service.ts`):
  - Retention: `putRetention(req, bucket, key)` reads `parseRetention(req.xmlBody)` → `obj.lock = { ...(obj.lock ?? {}), mode, retainUntil }` (preserves legal hold); `getRetention(_req, res, bucket, key)` writes `<Retention>` and throws `NoSuchObjectLockConfigurationError` (404) when `!obj.lock?.retainUntil || obj.lock.mode === ObjectLockMode.Off`.
  - Legal hold: `putLegalHold(req, bucket, key)` reads `parseLegalHold(req.xmlBody)` (boolean) → `obj.lock = { mode: ObjectLockMode.Off, ...(obj.lock ?? {}), legalHold: on }`; `getLegalHold(_req, res, bucket, key)` writes `<LegalHold>` defaulting to `OFF`.
- The admin adapter must NOT reuse the `@Res()` XML signature; load the current version (`objects.findCurrentVersion(bucket, key)`, `NoSuchKeyError` → 404), set `obj.lock` exactly as the domain methods do (`ObjectLockMode` from `@openbucket/persistence`), `persistAndFlush`, and return the JSON DTO. Map the JSON `retainUntil` (ISO string) to the stored `retainUntil` Date; legal-hold `status:'ON'|'OFF'` maps to the boolean `legalHold`.
- Routes (query-flag sub-resources, mirroring [TASK-1861]): `GET|PUT /api/admin/buckets/:name/objects/*?retention`; `GET|PUT /api/admin/buckets/:name/objects/*?legal-hold`. Branch inside the `*` handlers (or add dedicated handlers per the [TASK-1861] decision) — keep both tasks' approach consistent.
- Globally-unique operationIds (method-name factory): `getObjectRetention`/`putObjectRetention`, `getObjectLegalHold`/`putObjectLegalHold`.
- Validation = **400 ValidationFailed**. `mode` enum, `retainUntil` `z.string().datetime()`, `.strict()`.
- Audit: retention/legal-hold mutations emit `object.retention.changed` / `object.legalhold.changed` (`{ subject, bucket, key }`) — confirm/extend catalogue in [TASK-1864].
- Decorators: `@ApiOperation({ operationId })` + `@ApiParam({ name:'path' })` + `@ApiOkResponse({ type })`.

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) lists `get/putObjectRetention`, `get/putObjectLegalHold`; zero operationId collisions.
- [ ] `nx test openbucket-backend --testPathPatterns=objects-admin.controller.spec` (Node 20) passes ([TASK-1866]).
- [ ] PUT retention `{mode:'GOVERNANCE', retainUntil:'<future ISO>'}` persists; GET retention on an object with no lock → 404; legal-hold defaults to `OFF`.
- [ ] After [TASK-1865], `nx run api-client:check` is byte-equal.

## Test obligations
- Unit: covered by [TEST-0612] (via [TASK-1866]).
- E2E: covered by [TEST-0612].
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1861] (same controller file + shared `?`-flag dispatch decision), [STORY-0612] deps ([EPIC-05])

## References
- UX review 2026-06-22 (power-user — object-lock retention / legal hold).
- `apps/openbucket-backend/src/domain/objects/object.service.ts` (`put/getRetention`, `put/getLegalHold`, `ObjectLockMode`, `findCurrentVersion`), `s3/xml/s3-config-docs.ts` (`parseRetention`/`parseLegalHold`), `admin/objects/objects-admin.controller.ts`, `admin/audit/audit.service.ts`.
- See `[[project_admin_api_spec_drift]]`.
