---
id: TASK-3603
title: Wire the @openbucket/nestjs/multer subpath export + optional peer dep
story: STORY-1200
status: backlog
type: infra
size: S
---

## Description
Expose the adapter as a dedicated `@openbucket/nestjs/multer` subpath export of the
existing package (NOT a second npm package), keep `multer` an OPTIONAL peer so
headless/non-Express hosts never pull it, and make the new dep follow the repo's
3-place native-dep externalization rule so the standalone backend still bundles
and boots.

## Files to create / modify
- `libs/nestjs/package.json` — modify (add `exports["./multer"]`, add `multer` to
  `peerDependencies` + `peerDependenciesMeta.optional`, add `@types/multer` dev dep)
- `libs/nestjs/src/index.ts` — modify (add a documented pointer comment to the
  `./multer` subpath; do NOT re-export the adapter from the main barrel — that would
  drag `multer` into the `.` entry's type graph for headless hosts)
- `apps/openbucket-backend/webpack.config.js` — verify (the `externalDependencies`
  list is derived from `package.json` deps; confirm `multer` externalizes correctly)
- `libs/nestjs/src/lib/adapters/multer/index.ts` — verify barrel is the subpath entry

## Implementation notes
- **Subpath export** (compiled output lives under `src/**` per the existing build):
  ```jsonc
  "exports": {
    ".": { "types": "./src/index.d.ts", "default": "./src/index.js" },
    "./multer": {
      "types": "./src/lib/adapters/multer/index.d.ts",
      "default": "./src/lib/adapters/multer/index.js"
    },
    "./package.json": "./package.json"
  }
  ```
  `files` already includes `src`, so the compiled adapter ships. Add the barrel to
  `main`-less subpath only — do not touch `main`/`types` (they stay the `.` entry).
- **Optional peer, not a runtime dependency.** `multer` already sits at the
  workspace root (`package.json` `"multer": "^2.2.0"`) and is a transitive runtime
  dep of `@nestjs/platform-express` (which powers `FileInterceptor`). Declare it a
  peer so the host's single copy is used (no dual-instance busboy), and mark it
  optional so a headless host that never imports `./multer` is not warned:
  ```jsonc
  "peerDependencies": { "...": "...", "multer": "^2.0.0" },
  "peerDependenciesMeta": { "multer": { "optional": true } },
  "devDependencies": { "@types/multer": "^2.0.0" }
  ```
- **The 3-place native-dep externalization rule** — trace the new dep through all
  three so the standalone bundle stays correct:
  1. `libs/nestjs/package.json` — declared (as an optional peer here, since it is
     host-provided; a *new native* runtime dep would instead go in `dependencies`).
  2. `apps/openbucket-backend/package.json` — produced by webpack's
     `generatePackageJson: true`; it inherits the standalone app's own deps, and
     `multer` arrives transitively via `@nestjs/platform-express` (already present).
  3. `apps/openbucket-backend/webpack.config.js` — `externalDependencies` is
     `Object.keys(package.json.dependencies).filter(d => d !== '@openbucket/nestjs')`,
     so every third-party (native or not) stays external and only the workspace lib
     is inlined. Confirm `multer` resolves as external at runtime (it is not a native
     addon, so no prebuild concern — unlike `libsql`/`argon2`/`sharp`).
  `multer` is pure JS, so this is low-risk; the rule is documented here because it
  is the gate any *future* native dep must pass.
- **No second package.** Do not add a new workspace project or `project.json`. The
  adapter is `src/lib/adapters/multer/*` inside `@openbucket/nestjs`.
- **Edge case.** A host on `forwardRef`/ESM: the subpath is a normal Node
  `exports` map entry, resolvable by both `require` and `import` since the build
  emits CJS with `.d.ts` siblings (same shape as the `.` entry).

## Acceptance criteria
- [ ] `require.resolve('@openbucket/nestjs/multer')` (and the TS import) resolves to
      the compiled adapter barrel after `nx build nestjs` / `nx bundle-spa nestjs`.
- [ ] `multer` appears under `peerDependencies` + `peerDependenciesMeta.optional`;
      `@types/multer` under `devDependencies`; `multer` is NOT in `dependencies`.
- [ ] The `.` entrypoint (`src/index.ts`) contains no `import ... from 'multer'`.
- [ ] `nx build openbucket-backend` produces a bundle that boots (multer stays
      external, resolved from the app's `node_modules`).
- [ ] `nx build nestjs` + `nx lint nestjs` pass.

## Test obligations
- Unit: N/A — infra wiring.
- E2E: covered by [TEST-1200] (the round-trip app imports from
  `@openbucket/nestjs/multer`, proving the export resolves).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3600], [TASK-3601], [TASK-3602]

## References
- `libs/nestjs/package.json` — current `exports`, `peerDependencies`, `files`.
- `apps/openbucket-backend/webpack.config.js` — `externalDependencies` derivation
  (`:12`–`:14`) and the "native deps stay external" comment (`:4`–`:11`).
- Root `package.json` `"multer": "^2.2.0"`.
