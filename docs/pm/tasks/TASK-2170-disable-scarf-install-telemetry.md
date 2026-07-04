---
id: TASK-2170
title: Disable @scarf/scarf install-time telemetry in the dependency tree
story: STORY-0707
status: ready
type: infra
size: XS
---

## Description

Neutralize the transitive install-time telemetry beacon confirmed by audit finding
[19]. The published runtime dependency `@nestjs/swagger` (`libs/nestjs/package.json:35`,
`"@nestjs/swagger": "^11.0.0"`) resolves `swagger-ui-dist`, which declares
`@scarf/scarf@1.4.0`. `@scarf/scarf` carries `hasInstallScript: true`: its `postinstall`
runs arbitrary JS at `npm install` time and beacons install analytics (OS/arch, node
version, hashed package names, source IP) to `scarf.sh`. This fires silently in every
consumer's build/CI network for a package (an object store) that has no functional need
for install-time analytics. This Task suppresses the beacon deterministically for
OpenBucket's own build and best-effort for downstream consumers, without removing the
functional `swagger-ui-dist` UI. It is an info-level supply-chain/privacy hygiene fix,
not a code-execution patch.

## Files to create / modify

- `libs/nestjs/package.json` — modify: add a top-level `"scarfSettings": { "enabled": false }`
  field (scarf-js's vendor-documented disable, honored via its chain-disabled check) so a
  downstream `npm install @openbucket/nestjs` suppresses the beacon best-effort.
- `Dockerfile` — modify (line 37): the image build already runs `npm ci --no-audit --no-fund`;
  add `--ignore-scripts` (or export `SCARF_ANALYTICS=false` / `DO_NOT_TRACK=1` before the
  install) so OpenBucket's own image build deterministically never fires the beacon. If
  `--ignore-scripts` is used, ensure `argon2`'s native build still runs (it ships prebuilt
  binaries, so `npm ci` fetches them rather than compiling — the comment at `Dockerfile:14`
  already documents this).
- `.github/workflows/ci.yml`, `.github/workflows/release-nestjs.yml` — modify: set
  `SCARF_ANALYTICS=false` (and/or `DO_NOT_TRACK=1`) in the job env (or add `--ignore-scripts`
  to the `npm ci` invocations at `ci.yml:43,75,152` and `release-nestjs.yml:53`) so CI never
  emits the beacon.
- `libs/nestjs/README.md` (or `SECURITY.md`) — modify: document `DO_NOT_TRACK=1` /
  `SCARF_ANALYTICS=false` for privacy-sensitive consumer CI.

## Implementation notes

- CWE: **CWE-506 (Embedded Malicious Code)** as reported, reclassified by the verifier to
  **info-level supply-chain / install-time-telemetry hygiene** — Scarf is legitimate,
  opt-out-able, ecosystem-ubiquitous telemetry that hashes identifiers and cannot break the
  build. Do **not** frame or patch this as malicious-code / RCE.
- Confirmed reachability (do not re-litigate): runtime dep `@nestjs/swagger` (`^11.0.0`) →
  `swagger-ui-dist@5.32.8` → `@scarf/scarf@1.4.0` with `hasInstallScript: true`; the beacon
  is default-on and nothing in OpenBucket disables it.
- Primary fix, most robust first (per the finding's fix note):
  1. **Deterministic for our own build/CI:** install with `npm ci --ignore-scripts`, or set
     env `DO_NOT_TRACK=1` / `SCARF_ANALYTICS=false`, which prevents the beacon regardless of
     `npm ls` behavior.
  2. **Best-effort for downstream consumers:** add `"scarfSettings": { "enabled": false }` to
     `libs/nestjs/package.json`. scarf-js honors an `anyInChainDisabled` check
     (`report.js` ~lines 164–166, 182–184: disabled when any package in the dep chain sets
     `scarfSettings.enabled === false`). Caveat: this relies on `npm ls --long` surfacing the
     field, so it is best-effort, not as airtight as `--ignore-scripts`.
  3. Optionally consider making `@nestjs/swagger` an optional/peer dependency so consumers who
     do not need the admin Swagger UI never pull `swagger-ui-dist`/`scarf` at all (larger
     change — flag as follow-up, out of this XS Task's scope).
- **Do not** attempt `overrides` on `swagger-ui-dist` to strip scarf: scarf is a hard
  dependency of `swagger-ui-dist`, so an override cannot remove it (per the finding's note).

## Acceptance criteria

- [ ] `libs/nestjs/package.json` contains `"scarfSettings": { "enabled": false }` at the top
      level (verifiable by parsing the manifest — asserted in [TEST-0707]).
- [ ] The CI/Docker install path sets `SCARF_ANALYTICS=false` / `DO_NOT_TRACK=1` or passes
      `--ignore-scripts`, so a clean install produces **no** outbound connection to `scarf.sh`
      (asserted in [TEST-0707]).
- [ ] `argon2` native module still resolves and the image builds/boots after the change (no
      regression from `--ignore-scripts`).

## Test obligations

- Unit: covered by [TEST-0707] (manifest-field assertion + install-telemetry suppression).
- E2E: N/A — pure dependency/CI hygiene, no request-path surface.
- Conformance: N/A.

## Dependencies

- Blocked by: none.

## References

- White-box security audit, 2026-07-04 — finding [19] (@scarf/scarf install telemetry).
- `libs/nestjs/package.json:35` (`@nestjs/swagger`); `Dockerfile:37`, `.github/workflows/ci.yml`,
  `.github/workflows/release-nestjs.yml:53` (install commands).
- scarf-js disable mechanism: `scarfSettings.enabled`, `SCARF_ANALYTICS` / `DO_NOT_TRACK` env.
