---
id: STORY-0500
title: OpenAPI export and Angular client generation pipeline
epic: EPIC-06
status: done
size: M
risk: medium
---

## User story
As a developer, I want a deterministic OpenAPI export and Angular client regeneration pipeline wired into Nx, so that the committed `@openbucket/api-client` library is always in lockstep with the backend Nest controllers and CI fails when it drifts.

## Description
Wire the three Nx targets from §5.16: `backend:openapi:export` (boots the Nest app in spec-only mode, writes `apps/backend/dist/openapi.json`), `api-client:generate` (runs `openapi-generator-cli typescript-angular` against the spec into `libs/api-client/src/lib`), and `api-client:check` (regenerates and `git diff --exit-code` on the lib to detect drift). Add a barrel export and a `@openbucket/api-client` tsconfig path alias so SPA code imports from the package name only. The `check` target is the CI gate; running it locally regenerates and shows what drifted.

## Acceptance criteria
- [ ] `nx run backend:openapi:export` writes a JSON document to `apps/backend/dist/openapi.json` containing the admin controllers' paths.
- [ ] `nx run api-client:generate` (re)populates `libs/api-client/src/lib/` from that JSON using `openapi-generator-cli typescript-angular`.
- [ ] `nx run api-client:check` exits 0 when the committed lib is fresh and non-zero (with the run-generate-and-commit hint) when it is stale.
- [ ] `nx run api-client:build` packages the lib via `@nx/angular:package` and depends on `generate`.
- [ ] `@openbucket/api-client` resolves to `libs/api-client/src/index.ts` for SPA consumers.

## Tasks
- [TASK-1500] Write the OpenAPI export script
- [TASK-1501] Add `openapi:export` Nx target to backend project
- [TASK-1502] Add `generate`, `check`, and `build` Nx targets to api-client project
- [TASK-1503] Add api-client barrel and tsconfig path alias
- [TASK-1504] Install `openapi-generator-cli`, `nestjs-zod`, and `rimraf` dev dependencies

## Test plan
- [TEST-0500] OpenAPI client freshness CI check

## Dependencies
- Blocks: [STORY-0501], [STORY-0502]
- Blocked by: _none within EPIC-06; depends on admin controllers existing at the Epic level (see EPIC-05)_

## References
- `docs/WHITEPAPER.md` §5.16 (lines 8325–8450)
- Interfaces produced: `apps/backend/dist/openapi.json`; `libs/api-client/src/lib/**`; `@openbucket/api-client` package alias
- Interfaces consumed: `AppModule` from [EPIC-01], admin controllers from [EPIC-05]

## Verification (2026-06-24)
Verified locally (Node 20 export + WSL-Docker `openapi-generator-cli` v7.14.0):
- `backend:openapi:export` writes `dist/apps/openbucket-backend/openapi.json` (26 admin paths).
- `api-client:generate` repopulates `libs/api-client/src/lib`; a clean regen diffs **byte-equal** to the committed client (commit 56af102), so `api-client:check` (`git diff --exit-code`) passes → TEST-0500 green.
- `@openbucket/api-client` resolves to `libs/api-client/src/index.ts` (tsconfig path alias).
- **Deviation (AC #4 / TASK-1502 `build` target):** obsolete — the generated-client migration (STORY-0417) consumes the lib as **source** (`src/index.ts → export * from './lib'`), so there is no `@nx/angular:package` build target. The export → generate → freshness pipeline is the verified deliverable.
