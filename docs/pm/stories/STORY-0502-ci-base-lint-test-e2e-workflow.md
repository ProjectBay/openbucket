---
id: STORY-0502
title: CI base lint, unit, and e2e workflow
epic: EPIC-06
status: review
size: M
risk: medium
---

## User story
As a developer, I want every PR to `main` to run lint, unit tests, the api-client freshness check, and the backend e2e suite in GitHub Actions, so that regressions in code style, unit behavior, generated client drift, or HTTP/auth wiring are caught before merge.

## Description
Add `.github/workflows/ci.yml` with two jobs from §5.19: `lint-and-test` (checkout, setup-node 22 with npm cache, `npm ci`, `nrwl/nx-set-shas`, `nx run-many --target=lint`, `nx run-many --target=test --ci --coverage`, `nx run api-client:check`, coverage artifact upload) and `e2e` (downstream of `lint-and-test`, creates `tmp/e2e-data`, exports `DATA_DIR` and `JWT_SECRET`, runs `nx run backend-e2e:e2e --ci`). The workflow is triggered on push to `main` and PRs targeting `main`, with `concurrency` cancelling stale runs per ref.

## Acceptance criteria
- [ ] `.github/workflows/ci.yml` exists with `name: ci`, triggers on `push.branches: [main]` and `pull_request.branches: [main]`.
- [ ] `concurrency.group` is `ci-${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`.
- [ ] `env.NODE_VERSION` is `'22'`.
- [ ] Job `lint-and-test` runs lint, unit tests with `--coverage`, and `nx run api-client:check`, uploading `coverage/` as an artifact `if: always()`.
- [ ] Job `e2e` depends on `lint-and-test`, sets `DATA_DIR` to `${{ github.workspace }}/tmp/e2e-data` and `JWT_SECRET=test-secret-not-for-prod-not-for-prod`, and runs `nx run backend-e2e:e2e --ci`.
- [ ] CI status is green on a clean tree against `main`.

## Tasks
- [TASK-1520] Create `.github/workflows/ci.yml` skeleton with triggers, env, concurrency
- [TASK-1521] Wire the `lint-and-test` job
- [TASK-1522] Wire the `e2e` job
- [TASK-1523] Verify `nrwl/nx-set-shas` derives correct affected base on PRs

## Test plan
_The Story acceptance criteria are CI-green; no separate Test Plan (the CI workflow is itself the verification harness)._

## Dependencies
- Blocks: [STORY-0503]
- Blocked by: [STORY-0500]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8586–8656)
- Interfaces produced: GitHub Actions jobs `lint-and-test`, `e2e`
- Interfaces consumed: `nx run-many --target=lint`, `nx run-many --target=test`, `nx run backend-e2e:e2e`, `nx run api-client:check`

## Verification status (2026-06-24) — still `review`
Underlying targets all pass locally (the jobs would be green):
- `nx run-many --target=lint --all` → exit 0 for all 63 projects (commits 4d363b8, 81fd337).
- backend unit 443 pass; backend e2e 162 pass / 0 fail (commit 51f214d).
- `api-client:check` byte-equal (commit 56af102).

Residual — needs a real GitHub Actions runner, cannot verify here:
- AC "CI status green on main" (no local runner).
- **TASK-1523** (verify `nrwl/nx-set-shas` affected base on PRs) remains **blocked**.
- Minor AC/impl drift: the `e2e` job in `ci.yml` does not set `DATA_DIR`/`JWT_SECRET` (the AC lists them) because `spawn-app.ts` supplies per-spawn env itself.
