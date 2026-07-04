---
id: TASK-2724
title: Regenerate the OpenAPI client and wire the byte-equal check
story: STORY-0902
status: backlog
type: infra
size: S
---

## Description

Export the OpenAPI document with the new replication routes and regenerate the
committed `@openbucket/api-client` so the SPA has a typed `ReplicationAdminService`
and the `ReplicationStatus` / `ReconcileJob` models. Commit the generated output so
the CI byte-equal gate stays green.

## Files to create / modify

- `libs/api-client/src/lib/api/replication-admin.service.ts` — new (generated)
- `libs/api-client/src/lib/api/replication-admin.serviceInterface.ts` — new (generated)
- `libs/api-client/src/lib/api/api.ts` — modify (generated barrel adds the service)
- `libs/api-client/src/lib/model/*.ts` — new/modify (generated `ReplicationStatus`, `BucketReplicationStatus`, `ReconcileJob`, `ReconcileRequest` models)
- `libs/api-client/src/lib/.openapi-generator/FILES` — modify (generated manifest)

## Implementation notes

- Pure regeneration — do not hand-edit generated files. Run:
  ```
  nx run api-client:generate
  ```
  which `dependsOn` `openbucket-backend:openapi:export` (writes
  `dist/apps/openbucket-backend/openapi.json`) and then runs
  `openapi-generator-cli generate -g typescript-angular` into `libs/api-client/src/lib`.
- The new service class name derives from the controller tag; with
  `@Controller('api/admin/replication')` and the `@ApiOperation` `operationId`s from
  [TASK-2721], expect `ReplicationAdminService` with `getReplicationStatus`,
  `startReconcile(reconcileRequest)`, `getReconcileJob(jobId)`.
- Because DTOs use `.meta({ id })` (zod 4 named components), the models emit as
  shared `ReplicationStatus` / `BucketReplicationStatus` / `ReconcileJob` types
  rather than inline anonymous shapes — verify no `...Inner` duplicates leak.
- Commit ALL generated changes; the `api-client:check` target runs
  `git diff --exit-code -- libs/api-client/src/lib` and fails CI if the committed
  client is stale.
- No manual provider wiring needed in the SPA: generated services are
  `providedIn: 'root'` and reachable via `inject(ReplicationAdminService)`.

## Acceptance criteria

- [ ] `nx run api-client:generate` produces `ReplicationAdminService` with the three operations and the `ReplicationStatus`/`ReconcileJob` models.
- [ ] `nx run api-client:check` exits 0 after committing (client is byte-equal to a fresh regen).
- [ ] `nx build openbucket-frontend` resolves `ReplicationAdminService`, `ReplicationStatusDto`, `ReconcileJobDto` imports from `@openbucket/api-client`.

## Test obligations

- Unit: N/A — pure codegen/infra
- E2E: N/A
- Conformance: covered indirectly — [TEST-0902] consumes the generated client in the store spec

## Dependencies

- Blocked by: [TASK-2721] (controller + `operationId`s + DTOs define the OpenAPI surface)

## References

- `libs/api-client/project.json` (`generate` + byte-equal `check` targets)
- `apps/openbucket-backend/project.json` (`openapi:export` target)
- `libs/api-client/src/lib/api/buckets-admin.service.ts` (generated-service shape)
</content>
