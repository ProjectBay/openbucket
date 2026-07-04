---
id: STORY-0707
title: Supply-chain & dependency hygiene
epic: EPIC-08
status: ready
size: S
risk: low
---

## User story

As an operator embedding `@openbucket/nestjs` (and as a developer maintaining the
monorepo), I want the dependency graph to run no unsolicited install-time telemetry
and to classify build-only tooling as dev-only, so that installing OpenBucket emits
no third-party network beacons in my CI and `npm audit --omit=dev` gives a clean,
trustworthy production advisory signal.

## Description

This Story closes the two INFO-level supply-chain findings from the 2026-07-04
white-box audit. Finding [19] confirmed that the published runtime dependency
`@nestjs/swagger` pulls `swagger-ui-dist` → `@scarf/scarf@1.4.0`, whose `postinstall`
opens an outbound HTTPS beacon to `scarf.sh` in every consumer's build — telemetry an
object store has no functional need for. Finding [20] confirmed that `@nx/nest` is the
lone Nx build package declared under the root `dependencies` block instead of
`devDependencies`, dragging the Nx toolchain (and its dev-only ReDoS advisories) into
`npm audit --omit=dev` and masking the production signal. Both are hygiene fixes with
nil live impact, but they harden the supply chain and keep the audit signal clean.

## Acceptance criteria

- [ ] Installing the workspace (and building the Docker image) with the configured
      install command emits **no** outbound beacon to `scarf.sh` — verified by asserting
      the scarf-js disable path is active (`scarfSettings.enabled: false` in
      `libs/nestjs/package.json` and/or `--ignore-scripts` / `SCARF_ANALYTICS=false`
      on the install).
- [ ] `@nx/nest` no longer appears in the root `package.json` `dependencies` block; it
      is under `devDependencies` alongside the other `@nx/*` packages, with its version
      reconciled to the rest of the Nx toolchain.
- [ ] `npm audit --omit=dev` reports zero high/critical advisories, and a CI step fails
      the build if that ever regresses.
- [ ] `libs/nestjs/package.json` still requires no change to its own runtime
      `dependencies` (it does not reference `@nx/nest`); only the scarf-disable field is
      added.

## Tasks

- [TASK-2170] Disable @scarf/scarf install telemetry
- [TASK-2171] Move @nx/nest to devDependencies and add an npm audit gate

## Test plan

- [TEST-0707] Dependency-graph classification & install-telemetry suppression

## Dependencies

- Blocks: (a clean `npm audit --omit=dev` gate for the 0.1.x hardened line)
- Blocked by: none — pure dependency-manifest / CI changes with no code coupling.
- Note: this Story is independent of the rest of EPIC-08, but the epic's critical
  P0 — [STORY-0700] [TASK-2100] (the unauthenticated `GET /api/Admin/*` bypass,
  CWE-178) — must land first as a patch release; the INFO-level hygiene work here
  should be scheduled as routine maintenance behind it, not ahead of it.

## References

- White-box security audit, 2026-07-04 — findings [19] (@scarf/scarf install telemetry,
  CWE-506 reclassified to info-level supply-chain/privacy hygiene) and [20] (@nx/nest
  misclassified under production dependencies, CWE-710).
- `libs/nestjs/package.json:35` — `"@nestjs/swagger": "^11.0.0"` (runtime dep whose
  `swagger-ui-dist` → `@scarf/scarf@1.4.0` chain carries the postinstall beacon).
- `package.json:56` — `"@nx/nest": "^21.6.11"` inside `dependencies`; sibling `@nx/*`
  packages are under `devDependencies` (lines 92–100, pinned `22.7.2`); root is
  `"private": true` (line 6).
- `.github/workflows/ci.yml`, `Dockerfile:37` — install currently runs
  `npm ci --no-audit --no-fund`; no audit gate exists yet.
