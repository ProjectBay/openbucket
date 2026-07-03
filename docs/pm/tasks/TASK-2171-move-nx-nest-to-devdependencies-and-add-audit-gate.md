---
id: TASK-2171
title: Move @nx/nest to devDependencies and add an npm audit gate
story: STORY-0707
status: ready
type: infra
size: XS
---

## Description

Correct the dependency misclassification confirmed by audit finding [20] and add a
production-scope audit gate. In the root `package.json`, `"@nx/nest": "^21.6.11"` is
declared inside the production `dependencies` block (`package.json:56`) while every
sibling Nx package (`@nx/angular`, `@nx/eslint`, `@nx/js`, `@nx/node`, `@nx/web`,
`@nx/webpack`, `@nx/workspace`, `nx`) is correctly under `devDependencies` (lines
92–100, 130). This lone outlier drags the Nx build toolchain — where the dev-only ReDoS
advisories (`minimatch`/`picomatch`/`brace-expansion`, GHSA-3ppc-4f35-3m26,
GHSA-c2c7-rcm5-vvqj) resolve — into the production graph, so `npm audit --omit=dev`
reports dev-only findings and could mask a genuinely-shipped prod advisory in future.
This Task moves `@nx/nest` to `devDependencies`, reconciles its version with the rest of
the Nx toolchain, and adds a CI step that fails on high/critical production advisories.

## Files to create / modify

- `package.json` — modify: remove `"@nx/nest": "^21.6.11"` from `dependencies`
  (line 56) and add it under `devDependencies` alongside the other `@nx/*` packages.
  Reconcile the version: siblings are pinned to `22.7.2` while `@nx/node` (line 97) and
  `@nx/nest` sit at `21.6.11` — align `@nx/nest` (and, if reconciling the split,
  `@nx/node`) to the rest of the Nx toolchain to avoid a split Nx install.
- `package-lock.json` — modify: regenerate via `npm install` so the lockfile reflects the
  moved/reconciled dependency (respecting `.npmrc` `legacy-peer-deps=true`).
- `.github/workflows/ci.yml` — modify: add a step (in the `lint-and-test` job) that runs
  `npm audit --omit=dev --audit-level=high` and fails the build on any high/critical
  production advisory. Keep the existing `npm ci --no-audit --no-fund` install steps; the
  audit gate is a separate, explicit step so install stays deterministic.

## Implementation notes

- CWE: **CWE-710 (Improper Adherence to Coding Standards — dependency misclassification)**.
  There is **no** live attack path: the root package is `"private": true` (`package.json:6`),
  never published, and Nx tooling is not on the server request path. Impact is audit noise /
  signal degradation only. Schedule as routine maintenance, not an incident.
- The published artifact `@openbucket/nestjs` (`libs/nestjs/package.json`) does **not**
  reference `@nx/nest` at all (not in `dependencies`, not in `peerDependencies`); a
  `grep -rn "@nx/nest"` hits only the root `package.json`, the lockfile, and Nx's workspace
  cache. **No change to `libs/nestjs/package.json` is required** for this Task.
- The move exactly mirrors the finding's fix note: "Move `\"@nx/nest\": \"^21.6.11\"` from
  `dependencies` (line 56) to `devDependencies` alongside the other `@nx/*` packages, and
  align its version with the rest of the Nx toolchain." After the move, `npm audit --omit=dev`
  should drop the dev-only ReDoS advisories, restoring the production signal.
- Audit gate: `npm audit --omit=dev --audit-level=high` returns a non-zero exit code when a
  high/critical advisory exists in the production graph, which fails the CI job. This directly
  supports the EPIC-08 success criterion "`npm audit --omit=dev` reports no high/critical
  advisories in CI."

## Acceptance criteria

- [ ] `@nx/nest` is absent from the root `package.json` `dependencies` block and present under
      `devDependencies` (asserted in [TEST-0707]).
- [ ] `@nx/nest`'s version is reconciled with the sibling Nx toolchain (no split install;
      asserted in [TEST-0707]).
- [ ] `npm audit --omit=dev --audit-level=high` exits `0` locally and in CI, and the new CI
      step fails the build if a high/critical production advisory is introduced.
- [ ] `package-lock.json` is regenerated and `npm ci` still installs cleanly.

## Test obligations

- Unit: covered by [TEST-0707] (manifest-classification + `npm audit --omit=dev` assertions).
- E2E: N/A — dependency-manifest / CI change, no runtime surface.
- Conformance: N/A.

## Dependencies

- Blocked by: none. (Independent of [TASK-2170]; both land under [STORY-0707].)

## References

- White-box security audit, 2026-07-04 — finding [20] (@nx/nest misclassification, CWE-710).
- `package.json:56` (`@nx/nest` under `dependencies`), lines 92–100 & 130 (sibling `@nx/*`
  under `devDependencies`), line 6 (`"private": true`).
- `.github/workflows/ci.yml` — existing `npm ci --no-audit --no-fund` steps (lines 43, 75, 152).
- Advisories: GHSA-3ppc-4f35-3m26, GHSA-c2c7-rcm5-vvqj (dev-only ReDoS in Nx transitive deps).
