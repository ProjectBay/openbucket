---
id: STORY-0501
title: Docker multi-stage build image
epic: EPIC-06
status: done
size: M
risk: medium
---

## User story
As a release manager, I want a deterministic two-stage `Dockerfile` that produces a single non-root `node:22-bookworm-slim` runtime image serving the SPA and the S3 protocol on port 9000, so that operators can `docker run` OpenBucket from any host without a Node.js toolchain.

## Description
Implement the multi-stage Dockerfile from §5.17 verbatim: stage 1 (`build`) installs apt build deps, `npm ci`, regenerates the api-client, builds the SPA, builds the backend, copies the SPA into `apps/backend/dist/spa/`, then `npm prune --omit=dev`. Stage 2 (`runtime`) is a fresh `node:22-bookworm-slim` with a non-root `openbucket` user (uid 10001), `/data` volume, `EXPOSE 9000`, a `HEALTHCHECK` curling `/api/admin/health`, and `ENTRYPOINT ["node", "dist/main.js"]`. Ship a `.dockerignore` that strips `.git`, caches, docs, tests, `node_modules`, and accidentally-created `data/` directories so the build context stays small. Document the alpine-prohibition rationale inline (`better-sqlite3` glibc prebuilds).

## Acceptance criteria
- [ ] `docker build -t openbucket:local .` from a clean checkout produces a runnable image.
- [ ] The image runs as uid 10001 (`docker run --rm openbucket:local id` shows non-root).
- [ ] `EXPOSE 9000`, `VOLUME ["/data"]`, and the `HEALTHCHECK` all appear in `docker inspect`.
- [ ] `ENTRYPOINT` is `["node", "dist/main.js"]`.
- [ ] `.dockerignore` is present at repo root and excludes `node_modules`, `dist`, `.git`, `docs`, `.github`, `**/*.spec.ts`, `**/*.e2e-spec.ts`, and local `data/`.
- [ ] The Dockerfile contains a comment explaining the bookworm-slim choice over alpine.

## Tasks
- [TASK-1510] Author the multi-stage Dockerfile
- [TASK-1511] Add the alpine-prohibition rationale comment block
- [TASK-1512] Author `.dockerignore` at repo root
- [TASK-1513] Wire the HealthController stub for the healthcheck endpoint contract

## Test plan
- [TEST-0501] Docker image smoke: build, run, health probe

## Dependencies
- Blocks: [STORY-0503]
- Blocked by: [STORY-0500]

## References
- `docs/WHITEPAPER.md` §5.17 (lines 8452–8530), §5.18 (lines 8531–8585)
- Interfaces produced: `openbucket:<tag>` image with port 9000, `/data` volume, `node dist/main.js` entrypoint
- Interfaces consumed: backend build output (EPIC-01), frontend build output (EPIC-05), `GET /api/admin/health` (EPIC-05)
