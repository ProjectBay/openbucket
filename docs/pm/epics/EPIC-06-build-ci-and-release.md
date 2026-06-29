---
id: EPIC-06
title: Build, CI & release
status: backlog
whitepaper_section: "§5.16–§5.20"
owner_area: delivery
---

## Objective

Ship OpenBucket as a single Docker image with a deterministic build,
a fresh OpenAPI-derived Angular client, and a CI pipeline that gates
merges on unit + e2e green and, for PRs to `main` and tags, on a
real-client S3 conformance suite. This Epic owns everything from the
OpenAPI export script through the Dockerfile (locked to
`node:22-bookworm-slim` for `better-sqlite3` glibc compatibility) to
the GitHub Actions workflows and the three test-sample patterns.

## Scope

- In scope:
  - OpenAPI export Nx target: boot the app briefly, write `dist/openapi.json`.
  - Angular client generation Nx target: `openapi-generator-cli typescript-angular` → `libs/api-client`.
  - CI freshness check: fail if the committed client differs from the generated one.
  - Multi-stage `Dockerfile`: build stage produces backend + frontend dist; runtime stage `node:22-bookworm-slim` with prod-only `node_modules`. Documented prohibition of alpine.
  - `.dockerignore`.
  - GitHub Actions workflows: `lint-and-test`, `e2e`, `build-image` (PR + tag), and `conformance` (PR-to-main + tag) with the aws-cli / mc / s3cmd matrix using `testcontainers`.
  - Three test-sample patterns (unit, e2e, conformance) consumed across other Epics.
- Out of scope:
  - Application code itself — owned by EPIC-01 through EPIC-05.
  - Frontend feature code — owned by EPIC-05.

## Success criteria

- A fresh `docker build .` from a clean checkout produces an image that runs `node dist/apps/backend/main.js` and serves both the SPA and the S3 protocol.
- `nx run-many --target=test` is green; `nx run backend-e2e:e2e` is green.
- On a PR to `main`, the conformance job spins the built image with `testcontainers` and exercises `aws-cli`, `mc`, and `s3cmd` against it, with the gate red on any failure.
- The committed `@openbucket/api-client` is byte-equal to a fresh regeneration; CI fails otherwise.

## Stories

- [STORY-0500] OpenAPI export and Angular client generation pipeline
- [STORY-0501] Docker multi-stage build image
- [STORY-0502] CI base lint, unit, and e2e workflow
- [STORY-0503] CI Docker image build workflow
- [STORY-0504] CI S3 conformance suite (aws-cli, mc, s3cmd, AWS SDK)
- [STORY-0505] Testing patterns — unit, e2e, and conformance sample templates

## Dependencies

- Blocks: _none_
- Blocked by: [EPIC-01], [EPIC-02], [EPIC-03], [EPIC-04], [EPIC-05]

## References

- `docs/WHITEPAPER.md` §5.16–§5.20 (lines 8325–8947)
  - §5.16 OpenAPI generation pipeline (lines 8325–8451)
  - §5.17 Docker multi-stage build (lines 8452–8530)
  - §5.18 `.dockerignore` (lines 8531–8585)
  - §5.19 CI pipeline (lines 8586–8737)
  - §5.20 Testing patterns (lines 8738–8947)
- `docs/ARCHITECTURE.md` §1
- `docs/BACKEND-DESIGN.md` §7, §9
