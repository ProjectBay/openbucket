---
id: TEST-0707
title: Dependency-graph classification & install-telemetry suppression
covers: [STORY-0707, TASK-2170, TASK-2171]
status: ready
level: unit
---

## Goal

Verify the two supply-chain hygiene fixes for [STORY-0707]: that install-time telemetry
from `@scarf/scarf` is suppressed ([TASK-2170]), and that `@nx/nest` is classified as a
dev-only dependency so `npm audit --omit=dev` produces a clean production advisory signal
([TASK-2171]). These are manifest-shape and process-behavior assertions, run as a
lightweight unit/spec plus a CI step — no HTTP or S3 surface is involved.

## Setup

- A checkout of the monorepo root (`package.json`, `.npmrc` with `legacy-peer-deps=true`,
  `package-lock.json`) and `libs/nestjs/package.json`.
- Node `>=22.12.0` and npm available (matching `engines`).
- Read the manifests with `JSON.parse(fs.readFileSync(...))`; run `npm audit --omit=dev`
  and `npm ls` as child processes. For the beacon-suppression case, run the install in an
  offline / egress-monitored sandbox (or assert on the configured env/flags rather than
  observing the socket, since scarf hashes identifiers and the beacon is best-effort).

## Cases

1. **(TASK-2171) `@nx/nest` is not a production dependency.** Given the root `package.json`,
   when its `dependencies` object is inspected, then it does **not** contain the key
   `@nx/nest`; and its `devDependencies` object **does** contain `@nx/nest`.
2. **(TASK-2171) Nx toolchain version is reconciled.** Given the root `package.json`
   `devDependencies`, when the `@nx/*` package versions are compared, then `@nx/nest`'s
   version matches the sibling Nx toolchain (e.g. `22.7.2`) rather than the stale `^21.6.11`,
   so there is no split Nx install.
3. **(TASK-2171) Production audit is clean.** Given the reconciled, regenerated lockfile,
   when `npm audit --omit=dev --audit-level=high` runs, then it exits `0` with zero
   high/critical advisories (the dev-only ReDoS advisories GHSA-3ppc-4f35-3m26 /
   GHSA-c2c7-rcm5-vvqj no longer appear in the production graph). This is the assertion the
   new CI gate enforces.
4. **(TASK-2171) `libs/nestjs` runtime deps untouched.** Given `libs/nestjs/package.json`,
   when its `dependencies` and `peerDependencies` are inspected, then neither references
   `@nx/nest` (confirming the published artifact never pulled the toolchain).
5. **(TASK-2170) scarf disable field is present.** Given `libs/nestjs/package.json`, when the
   manifest is parsed, then it contains `scarfSettings.enabled === false` at the top level.
6. **(TASK-2170) Install emits no scarf beacon.** Given the CI/Docker install command, when a
   clean install runs (with `--ignore-scripts`, or `SCARF_ANALYTICS=false` / `DO_NOT_TRACK=1`
   in the env), then no outbound connection to `scarf.sh` is attempted — asserted by verifying
   the install command carries `--ignore-scripts` or the suppression env var, and (in an
   egress-monitored sandbox) that no `scarf.sh` request is observed. `argon2` still resolves so
   the build/boot is not regressed.

## Tooling

- Framework: jest (manifest/lockfile assertions + child-process spawn of `npm audit`/`npm ls`).
- Runner: `nx test` for the spec; `npm audit --omit=dev --audit-level=high` as the CI gate step.

## Pass criteria

- [ ] Cases 1–2 pass: `@nx/nest` is dev-only and version-reconciled.
- [ ] Case 3 passes: `npm audit --omit=dev --audit-level=high` exits `0` in CI.
- [ ] Case 4 passes: `libs/nestjs/package.json` runtime deps do not reference `@nx/nest`.
- [ ] Case 5 passes: `scarfSettings.enabled === false` is present in `libs/nestjs/package.json`.
- [ ] Case 6 passes: the install path suppresses the `@scarf/scarf` beacon with no `scarf.sh`
      egress, and `argon2` still builds/boots.

## References

- White-box security audit, 2026-07-04 — findings [19] (@scarf/scarf telemetry) and
  [20] (@nx/nest misclassification).
- `package.json:56` (`@nx/nest`); `libs/nestjs/package.json:35` (`@nestjs/swagger`);
  `.github/workflows/ci.yml`, `Dockerfile:37` (install commands).
