---
id: TASK-1540
title: Scaffold `apps/conformance` Nx project with an `e2e` target
story: STORY-0504
status: review
type: infra
size: S
---

## Description
Create the `apps/conformance` Nx project that hosts the conformance suite: a `project.json` with an `e2e` target running Jest against `apps/conformance/src/**/*.conformance.ts`, a Jest config that tolerates long boot times (the white-paper sample uses `90_000` ms timeouts), and a `tsconfig` that picks up `@openbucket/api-client` and `@aws-sdk/client-s3`.

## Files to create / modify
- `apps/conformance/project.json` — new
- `apps/conformance/jest.config.ts` — new
- `apps/conformance/tsconfig.json` — new
- `apps/conformance/tsconfig.spec.json` — new
- `apps/conformance/src/` — new directory

## Implementation notes
- The CI workflow references the target with `npx nx run conformance:e2e --ci` (white paper §5.19 line 8731). Match that exactly.
- Jest test-match pattern: `**/*.conformance.ts` (distinct from `*.spec.ts` and `*.e2e-spec.ts`).
- Add a `testTimeout` ≥ `90_000` to fit the container-boot wait in §5.20.3 (`startupTimeout: 60_000` plus margin).
- Install `testcontainers`, `@aws-sdk/client-s3` as devDependencies if not already.

## Acceptance criteria
- [ ] `nx run conformance:e2e` is invocable and runs Jest against `*.conformance.ts` files.
- [ ] An empty suite passes (no `*.conformance.ts` files yet) to confirm the harness boots.
- [ ] `@openbucket/api-client` and `@aws-sdk/client-s3` resolve from inside `apps/conformance/src/`.

## Test obligations
- Unit: N/A — infra.
- E2E: N/A
- Conformance: scaffolding is consumed by [TEST-0502].

## Dependencies
- Blocked by: _none within EPIC-06_

## References
- `docs/WHITEPAPER.md` §5.19 (line 8731), §5.20.3 (lines 8875–8947)
