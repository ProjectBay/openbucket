---
id: TASK-1512
title: Author `.dockerignore` at repo root
story: STORY-0501
status: done
type: infra
size: XS
---

## Description
Add a `.dockerignore` at the repo root that excludes source control, editor/OS junk, Nx/TS caches, docs, CI metadata, `node_modules`, test files, env files, and any accidentally-created local data directories, so the build context stays small and stale host-built `dist/` cannot leak into the image.

## Files to create / modify
- `.dockerignore` — new (repo root)

## Implementation notes
- Verbatim from white paper §5.18:

  ```
  # Source control
  .git
  .gitignore
  .gitattributes

  # Editor / OS
  .vscode
  .idea
  .DS_Store
  Thumbs.db

  # Nx / TS caches
  .nx
  .angular
  dist
  tmp
  coverage
  .cache

  # Docs (not needed in the image)
  docs
  *.md
  !README.md

  # CI metadata
  .github

  # Node
  node_modules
  npm-debug.log*
  yarn-debug.log*

  # Tests
  **/*.spec.ts
  **/*.e2e-spec.ts
  **/__tests__
  **/__fixtures__

  # Local env (never bake env files into images)
  .env
  .env.*
  !.env.example

  # Local data dirs accidentally created
  data
  local-data
  ```

- Excluding `dist` is deliberate: the build stage produces its own `dist` from sources; a stale host-built `dist` must not leak in (§5.18 closing note).

## Acceptance criteria
- [ ] `.dockerignore` exists at the repo root with the patterns above.
- [ ] `docker build` does not transfer `node_modules`, `.git`, `docs`, `.github`, or host `dist/` into the build context (verify by `docker build` log "Sending build context" size).
- [ ] `README.md` is *not* excluded (the `!README.md` re-include works).

## Test obligations
- Unit: N/A — infra; covered indirectly by [TEST-0501] (the build must still succeed).
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §5.18 (lines 8531–8582)
