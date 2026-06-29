---
id: STORY-0417
title: Wire the generated OpenAPI client into the SPA
epic: EPIC-05
status: done
size: S
risk: medium
---

## User story
As an admin user, I want the SPA to consume the generated `@openbucket/api-client` services directly via DI, so that all admin API calls are typed end-to-end from Zod schema → OpenAPI → TypeScript model.

## Description
Implement `apps/frontend/src/app/shared/api/api-client.providers.ts` per §5.13: `provideApiClient()` returns `EnvironmentProviders` wrapping `{ provide: Configuration, useValue: new Configuration({ basePath: '' }) }` and the three services `BucketsService`, `ObjectsService`, `KeysService`. The empty `basePath` is intentional — the SPA is served same-origin by the backend. Provide a representative `BucketListComponent` (§5.13) that consumes `BucketsService` via `inject`, holds `buckets` and `loading` signals, and renders the list. Add a `@ApiOperation({ operationId: 'listBuckets' })` (and the matching ones for create/get/delete) on the backend bucket controller so the generator emits readable method names (`listBuckets`, `createBucket`, `deleteBucket`).

## Acceptance criteria
- [x] `provideApiClient()` returns environment providers including `Configuration` (basePath `''`), `BucketsService`, `ObjectsService`, `KeysService`.
- [x] `BucketListComponent` is standalone, imports `CommonModule`, `RouterLink`, `ByteSizePipe`, `RelativeTimePipe`, calls `this.api.listBuckets()` (or the generator-named equivalent) in `ngOnInit`.
- [ ] (Deferred — TASK-1251) Backend `@ApiOperation` operationIds: N/A for the hand-authored interim client; lands with the M6/EPIC-06 OpenAPI codegen pipeline (the hand-written service method names already match the intended operationIds).
- [x] No hand-written DTO interfaces on the frontend — all model types are imported from `@openbucket/api-client`.

## Tasks
- [TASK-1250] Implement `provideApiClient()` environment providers
- [TASK-1251] Add `@ApiOperation` operationIds to backend bucket controller
- [TASK-1252] Implement `BucketListComponent` consuming `BucketsService`

## Test plan
- [TEST-0423] BucketListComponent unit spec (component-test scope: render + service interaction only)

## Dependencies
- Blocks: [STORY-0418], [STORY-0419]
- Blocked by: [STORY-0409], [STORY-0414], [STORY-0416], [EPIC-06] (OpenAPI generation pipeline producing `@openbucket/api-client`)

## References
- `docs/WHITEPAPER.md` §5.13 (lines 8069–8162)
- Interfaces produced: `provideApiClient`, `BucketListComponent`
- Interfaces consumed: `@openbucket/api-client` services and models (EPIC-06)
