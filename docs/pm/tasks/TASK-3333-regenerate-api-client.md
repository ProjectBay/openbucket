---
id: TASK-3333
title: Regenerate @openbucket/api-client for the audit endpoints
story: STORY-1103
status: backlog
type: infra
size: XS
---

## Description
Regenerate the typed Angular API client so the SPA can call the new audit endpoints. Running the existing `api-client:generate` target re-exports the OpenAPI spec (now containing `listAuditEvents` + `getAuditCatalog` from [TASK-3332]) and regenerates `libs/api-client/src/lib`, producing an `AuditAdminService` plus `AuditEvent`/`AuditPageDto`/`AuditCatalogDto` models.

## Files to create / modify
- `libs/api-client/src/lib/api/audit-admin.service.ts` — new (generated)
- `libs/api-client/src/lib/api/audit-admin.serviceInterface.ts` — new (generated)
- `libs/api-client/src/lib/api/api.ts` — modify (generated: register the new service)
- `libs/api-client/src/lib/model/audit-event.ts`, `.../audit-page-dto.ts`, `.../audit-catalog-dto.ts`, `.../models.ts` — new/modify (generated)
- (No hand edits — the tree is fully generated and `api-client:check` guards drift.)

## Implementation notes
- Command is the existing target — do not edit generated files by hand:
  ```
  nx run api-client:generate
  ```
  It `dependsOn` `openbucket-backend:openapi:export` (see `apps/openbucket-backend/src/openapi-export.ts`) then runs `openapi-generator-cli generate -g typescript-angular` with `providedIn=root, withInterfaces=true, fileNaming=kebab-case, stringEnums=true` (see `libs/api-client/project.json`).
- Because DTOs are declared with `.meta({ id: 'AuditEvent' })` etc., the generator emits shared models (not inline `...Inner` types), matching the `ObjectListItem` convention.
- The generated `AuditAdminService.listAuditEvents(event?, subject?, bucket?, from?, to?, cursor?, limit?)` returns `Observable<AuditPageDto>`; `getAuditCatalog()` returns `Observable<AuditCatalogDto>`. These are consumed by [TASK-3334].
- Commit the regenerated tree so `nx run api-client:check` (the `git diff --exit-code` gate) passes in CI.

## Acceptance criteria
- [ ] `nx run api-client:generate` produces `AuditAdminService` and the audit models under `libs/api-client/src/lib`.
- [ ] `nx run api-client:check` passes (no uncommitted drift).
- [ ] `AuditAdminService` is exported from `@openbucket/api-client` (via the barrel `libs/api-client/src/index.ts`).

## Test obligations
- Unit: N/A — pure codegen (verified by `api-client:check`)
- E2E: N/A
- Conformance: covered by [TEST-1103] (client-generation gate)

## Dependencies
- Blocked by: [TASK-3332]
</content>
