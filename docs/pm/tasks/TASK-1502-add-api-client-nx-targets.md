---
id: TASK-1502
title: Add `generate`, `check`, and `build` Nx targets to api-client project
story: STORY-0500
status: done
type: infra
size: S
---

## Description
Create `libs/api-client/project.json` with three targets: `generate` (rimraf + `openapi-generator-cli`, depending on `backend:openapi:export`), `check` (re-runs `generate` then `git diff --exit-code -- libs/api-client/src/lib`), and `build` (`@nx/angular:package`, depending on `generate`).

## Files to create / modify
- `libs/api-client/project.json` — new
- `libs/api-client/ng-package.json` — new (referenced by the `build` target; minimal `{ "lib": { "entryFile": "src/index.ts" } }`)

## Implementation notes
- Verbatim from white paper §5.16.3:

  ```jsonc
  // libs/api-client/project.json
  {
    "name": "api-client",
    "$schema": "../../node_modules/nx/schemas/project-schema.json",
    "projectType": "library",
    "sourceRoot": "libs/api-client/src",
    "targets": {
      "generate": {
        "executor": "nx:run-commands",
        "dependsOn": [{ "projects": ["backend"], "target": "openapi:export" }],
        "options": {
          "commands": [
            "rimraf libs/api-client/src/lib",
            "openapi-generator-cli generate -i apps/backend/dist/openapi.json -g typescript-angular -o libs/api-client/src/lib --additional-properties=ngVersion=18.0.0,providedIn=root,withInterfaces=true,fileNaming=kebab-case,stringEnums=true,supportsES6=true"
          ],
          "parallel": false
        },
        "outputs": ["{workspaceRoot}/libs/api-client/src/lib"]
      },
      "check": {
        "executor": "nx:run-commands",
        "dependsOn": ["generate"],
        "options": {
          "commands": [
            "git diff --exit-code -- libs/api-client/src/lib || (echo 'api-client is stale — run: nx run api-client:generate && commit' && exit 1)"
          ]
        }
      },
      "build": {
        "executor": "@nx/angular:package",
        "options": {
          "project": "libs/api-client/ng-package.json"
        },
        "dependsOn": ["generate"]
      }
    },
    "tags": ["scope:shared", "type:client"]
  }
  ```

- The `check` target is wired into CI (`nx run api-client:check`). It re-generates, then asks git whether anything changed; if so, the PR is told to run `nx run api-client:generate` locally and commit.
- `openapi-generator-cli typescript-angular` flags must be preserved exactly: `ngVersion=18.0.0,providedIn=root,withInterfaces=true,fileNaming=kebab-case,stringEnums=true,supportsES6=true`.

## Acceptance criteria
- [ ] `nx run api-client:generate` populates `libs/api-client/src/lib/` from the exported JSON.
- [ ] `nx run api-client:check` exits 0 when fresh and non-zero with the regenerate hint when stale.
- [ ] `nx run api-client:build` produces an Angular package via `@nx/angular:package`.

## Test obligations
- Unit: N/A — infra; covered by [TEST-0500].
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1501], [TASK-1504]

## References
- `docs/WHITEPAPER.md` §5.16.3 (lines 8394–8438)
