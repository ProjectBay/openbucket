---
id: TASK-1501
title: Add `openapi:export` Nx target to backend project
story: STORY-0500
status: done
type: infra
size: XS
---

## Description
Add an `openapi:export` target to `apps/backend/project.json` that runs the export script via `tsx` and declares the output JSON as a cacheable artifact.

## Files to create / modify
- `apps/backend/project.json` — modify (add `targets.openapi:export`)

## Implementation notes
- Verbatim from white paper §5.16.2:

  ```jsonc
  // apps/backend/project.json (relevant excerpt)
  {
    "targets": {
      "openapi:export": {
        "executor": "nx:run-commands",
        "options": {
          "commands": [
            "tsx apps/backend/src/openapi-export.ts"
          ],
          "parallel": false
        },
        "outputs": ["{workspaceRoot}/apps/backend/dist/openapi.json"]
      }
    }
  }
  ```

- `parallel: false` because there is a single command and Nx should not interleave.
- The `outputs` declaration lets Nx cache the JSON.

## Acceptance criteria
- [ ] `nx run backend:openapi:export` exits 0 and writes `apps/backend/dist/openapi.json`.
- [ ] Running it a second time without source changes is a cache hit.

## Test obligations
- Unit: N/A — infra; covered by [TEST-0500].
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1500]

## References
- `docs/WHITEPAPER.md` §5.16.2 (lines 8374–8392)
