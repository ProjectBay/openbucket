---
id: TASK-3313
title: Regenerate the typed API client for the search endpoint
story: STORY-1101
status: backlog
type: infra
size: S
---

## Description

Regenerate `@openbucket/api-client` from the updated OpenAPI export so the
console gets a typed `searchObjects` method and the `ObjectSearchHit` /
`ObjectSearchQuery` / `ObjectSearchResponse` models, and commit the diff so the
`api-client:check` CI gate stays green.

## Files to create / modify

- `libs/api-client/src/lib/**` — regenerated (do not hand-edit; output of the
  generator)
- Committed OpenAPI snapshot, if any is tracked under `dist`/exports — regenerate

## Implementation notes

- Run the existing pipeline, do not invent a new one:
  `nx run api-client:generate` — it depends on
  `openbucket-backend:openapi:export` (see `libs/api-client/project.json`), which
  writes `dist/apps/openbucket-backend/openapi.json`, then runs
  `openapi-generator-cli generate -g typescript-angular
  --additional-properties=…,withInterfaces=true,fileNaming=kebab-case,stringEnums=true`.
- Verify the generated `ObjectsAdminService` (or a new `ObjectsSearchAdminService`
  if the controller lands in its own tag group) exposes `searchObjects(q, mode,
  bucket?, tagKey?, tagValue?, cursor?, limit?)` returning `ObjectSearchResponse`.
- `nx run api-client:check` runs `git diff --exit-code -- libs/api-client/src/lib`
  — so the regenerated output MUST be committed; a stale client fails CI with the
  "api-client is stale" message.
- Pure infra: no runtime dependency added; the generator version
  (`@openapitools/openapi-generator-cli ^2.39.1`) is already in `package.json`.

## Acceptance criteria

- [ ] `nx run api-client:generate` produces a `searchObjects` method and the
      `ObjectSearchHit`/`ObjectSearchResponse` models under `libs/api-client/src/lib`.
- [ ] `nx run api-client:check` exits 0 after committing the regenerated files.
- [ ] `nx build openbucket-frontend` compiles against the new client symbols.

## Test obligations

- Unit: N/A — pure infra (client is generated)
- E2E: covered by [TEST-1101] (case 10, the console drives the generated method)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3311], [TASK-3312]

## References

- `libs/api-client/project.json` (`generate`, `check` targets)
- `package.json` (`@openapitools/openapi-generator-cli`)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`
  (existing `@openbucket/api-client` import usage)
