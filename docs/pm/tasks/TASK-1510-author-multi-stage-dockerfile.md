---
id: TASK-1510
title: Author the multi-stage Dockerfile
story: STORY-0501
status: done
type: infra
size: M
---

## Description
Write `Dockerfile` at repo root implementing the two-stage build from §5.17 verbatim: a `build` stage on `node:22-bookworm-slim` that installs apt build deps, runs `npm ci`, regenerates the api-client, builds the SPA and backend, copies the SPA into `apps/backend/dist/spa/`, and prunes dev deps; and a `runtime` stage on the same base that adds a non-root user, copies `dist`, `node_modules`, and `package.json` from the build stage, exposes 9000, declares the `/data` volume, sets a healthcheck, and runs `node dist/main.js`.

## Files to create / modify
- `Dockerfile` — new (repo root)

## Implementation notes
- Verbatim Dockerfile from white paper §5.17:

  ```dockerfile
  # Dockerfile
  # syntax=docker/dockerfile:1.7

  # ---------- stage 1 : build ----------
  FROM node:22-bookworm-slim AS build
  # bookworm-slim (glibc) — alpine (musl) breaks better-sqlite3 prebuilt bindings.
  # Rebuilding from source on alpine works but adds ~30s and a python toolchain.

  WORKDIR /workspace

  # System deps for native modules (better-sqlite3 prebuild headers, argon2).
  RUN apt-get update \
   && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
   && rm -rf /var/lib/apt/lists/*

  # Install dependencies with a deterministic lock.
  COPY package.json package-lock.json nx.json tsconfig.base.json ./
  COPY apps ./apps
  COPY libs ./libs
  COPY tools ./tools

  RUN --mount=type=cache,target=/root/.npm \
      npm ci --no-audit --no-fund

  # Build SPA first, then export OpenAPI, then build backend so the SPA dist and
  # generated client are present in the workspace before the backend ts compile.
  RUN npx nx run api-client:generate
  RUN npx nx build frontend --configuration=production
  RUN npx nx build backend  --configuration=production

  # Place the SPA assets inside backend dist where ServeStaticModule expects them.
  RUN mkdir -p apps/backend/dist/spa \
   && cp -R apps/frontend/dist/. apps/backend/dist/spa/

  # Trim dev dependencies for the runtime stage.
  RUN --mount=type=cache,target=/root/.npm \
      npm prune --omit=dev


  # ---------- stage 2 : runtime ----------
  FROM node:22-bookworm-slim AS runtime

  ENV NODE_ENV=production \
      DATA_DIR=/data \
      UV_THREADPOOL_SIZE=16 \
      NODE_OPTIONS=--enable-source-maps

  # Run as non-root; /data is owned at runtime by the entrypoint volume mount.
  RUN useradd -r -u 10001 -d /home/openbucket -m openbucket \
   && mkdir -p /data \
   && chown openbucket:openbucket /data

  WORKDIR /app

  COPY --from=build --chown=openbucket:openbucket /workspace/apps/backend/dist ./dist
  COPY --from=build --chown=openbucket:openbucket /workspace/node_modules ./node_modules
  COPY --from=build --chown=openbucket:openbucket /workspace/package.json ./package.json

  USER openbucket

  EXPOSE 9000
  VOLUME ["/data"]

  HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:9000/api/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

  ENTRYPOINT ["node", "dist/main.js"]
  ```

- Base image: `node:22-bookworm-slim` (both stages) — locked, see [TASK-1511].
- Runtime env: `NODE_ENV=production`, `DATA_DIR=/data`, `UV_THREADPOOL_SIZE=16`, `NODE_OPTIONS=--enable-source-maps`.
- User: uid 10001, name `openbucket`, home `/home/openbucket`.
- Exposed port: **9000**. Volume: **`/data`**. Entrypoint: **`["node", "dist/main.js"]`**.

## Acceptance criteria
- [ ] `docker build -t openbucket:local .` from a clean checkout succeeds.
- [ ] `docker inspect openbucket:local` shows `Config.ExposedPorts` includes `9000/tcp`, `Config.Volumes` includes `/data`, `Config.Entrypoint` is `["node","dist/main.js"]`, and `Config.User` is `openbucket`.
- [ ] `docker run --rm openbucket:local id -u` prints `10001`.

## Test obligations
- Unit: N/A — infra.
- E2E: N/A
- Conformance: covered by [TEST-0501] (smoke) and [TEST-0502] (conformance).

## Dependencies
- Blocked by: [STORY-0500]

## References
- `docs/WHITEPAPER.md` §5.17 (lines 8452–8528)
