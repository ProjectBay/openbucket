---
id: TEST-0501
title: Docker image smoke — build, run, health probe
covers: [STORY-0501, TASK-1510, TASK-1511, TASK-1512, TASK-1513]
status: done
level: e2e
---

## Goal
Verify that the multi-stage Dockerfile, the `.dockerignore`, and the runtime stage contracts (uid, port, volume, entrypoint, healthcheck) all work together: a clean `docker build` produces a runnable image, `docker run` boots the container, the healthcheck endpoint answers 200, and the container exits cleanly on SIGTERM.

## Setup
- Clean checkout of the repo.
- Docker 24+ with BuildKit available.
- Port 9000 free on the host.

## Cases
1. **Clean build.** Given a clean tree, when `docker build -t openbucket:smoke .` runs, then it exits 0 and produces an image whose size is ≤ 200 MB (sanity check on the slim base).
2. **Inspect runtime contract.** Given `openbucket:smoke`, when `docker inspect` is run, then `Config.ExposedPorts` includes `9000/tcp`, `Config.Volumes` includes `/data`, `Config.Entrypoint == ["node","dist/main.js"]`, and `Config.User == "openbucket"`.
3. **Non-root user.** Given the image, when `docker run --rm openbucket:smoke id -u` runs, then stdout is `10001`.
4. **Healthcheck answers.** Given `docker run -d --rm -p 9000:9000 -e JWT_SECRET=smoke-secret-smoke-secret-smoke-secret -e ROOT_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE -e ROOT_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY openbucket:smoke`, when waiting up to 30s and then `curl -fsS http://127.0.0.1:9000/api/admin/health`, then the response is HTTP 200 with body `{"status":"ok"}`.
5. **`.dockerignore` excludes `node_modules` and `dist`.** Given a host tree with `node_modules/` and a stale `dist/` present, when `docker build` runs, then the build log's "Sending build context to Docker daemon" size is dominated by `apps/`, `libs/`, `tools/`, and lockfiles — not `node_modules` or `dist`.
6. **Clean shutdown.** Given the running container from case 4, when `docker stop <id>` is issued, then the container exits with code 0 within 10s (no SIGKILL needed).

## Tooling
- Framework: shell + curl + `docker` CLI; optionally jest if the suite is wrapped as a Node test for CI.
- Runner: ad-hoc shell locally; in CI the `build-image` job covers the build half ([STORY-0503]).

## Pass criteria
- [ ] All six cases pass on a clean checkout.
- [ ] The `.dockerignore` is exercised (case 5) by deliberately creating noise in the host tree before building.

## References
- `docs/WHITEPAPER.md` §5.17 (lines 8452–8528), §5.18 (lines 8531–8582)
