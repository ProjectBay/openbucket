---
id: TASK-1865
title: Export OpenAPI + regenerate `@openbucket/api-client` and commit
story: STORY-0612
status: done
type: infra
size: S
---

## Description
Run the OpenAPI export over the new admin surface, regenerate `@openbucket/api-client` from it, and commit the regenerated client so the freshness gate (STORY-0500) stays green. This is the seam STORY-0613 (and 0604/0614/0615) consume — the new typed `BucketsAdminService`/`ObjectsAdminService` methods + DTO models must exist in the client.

## Files to create / modify
- `dist/apps/openbucket-backend/openapi.json` — regenerated artifact (not committed; produced by the export target)
- `libs/api-client/src/lib/**` — regenerated client (committed; the only checked-in output)

## Implementation notes
- Export: `nx run openbucket-backend:openapi:export` runs `ts-node --project apps/openbucket-backend/tsconfig.app.json -r tsconfig-paths/register apps/openbucket-backend/src/openapi-export.ts` (ts-node, NOT tsx — per `[[project_m6_openapi_and_env]]`). It sets placeholder env, imports `AppModule` dynamically, includes only `AdminModule` + `HealthModule`, and post-processes with nestjs-zod v5 `cleanupOpenApiDoc` (NOT `patchNestjsSwagger`). Run on **Node 20** (better-sqlite3 ABI).
- Regen: `nx run api-client:generate` depends on `openapi:export`, then runs `rimraf libs/api-client/src/lib` + `openapi-generator-cli generate -i dist/apps/openbucket-backend/openapi.json -g typescript-angular -o libs/api-client/src/lib --additional-properties=ngVersion=21.0.0,providedIn=root,withInterfaces=true,fileNaming=kebab-case,stringEnums=true,supportsES6=true`. The generator runs via the Docker image `openapitools/openapi-generator-cli:v7.14.0` (the `api-client:generate` path) — requires the Docker daemon (see `[[project_m6_openapi_and_env]]`: daemon may be down → this Task blocks on env).
- Freshness gate: `nx run api-client:check` runs `git diff --exit-code -- libs/api-client/src/lib` after regenerating — it must report no diff once the regenerated client is committed.
- Commit the regenerated `libs/api-client/src/lib/**` as part of this Story's single commit (per the one-commit-per-Story convention).

## Acceptance criteria
- [ ] `nx run openbucket-backend:openapi:export` (Node 20) writes `dist/apps/openbucket-backend/openapi.json` containing every operation from [TASK-1858..1863].
- [ ] `nx run api-client:generate` regenerates the client with the new `BucketsAdminService`/`ObjectsAdminService` methods + DTO models.
- [ ] `nx run api-client:check` exits 0 (byte-equal; client committed, no stale diff) — STORY-0500 gate green.

## Test obligations
- Unit: N/A — infra.
- E2E: covered by [TEST-0612] (the export + freshness gate are part of the e2e pass criteria).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1864] (all endpoints + decorators finalized)

## References
- `apps/openbucket-backend/project.json` (`openapi:export` target), `libs/api-client/project.json` (`generate`/`check` targets), `apps/openbucket-backend/src/openapi-export.ts`.
- STORY-0500 (api-client freshness gate). See `[[project_m6_openapi_and_env]]` (ts-node + cleanupOpenApiDoc; Docker daemon dependency), `[[project_node20_persistence]]`.
