# syntax=docker/dockerfile:1.7
#
# OpenBucket — single-image, multi-stage build (WHITEPAPER §5.17).
# Stage 1 builds the Angular SPA + the NestJS backend; stage 2 is a slim,
# non-root runtime that serves both on port 9000.
#
# ---- Why node:22-bookworm-slim, NOT alpine -------------------------------
# argon2 ships prebuilt native bindings linked against glibc; on alpine (musl)
# they're silently incompatible and npm falls back to compiling from source —
# which needs python3/make/g++ on BOTH stages, adds ~30s, and yields an image
# only marginally smaller. bookworm-slim (~85MB) is the boring, correct choice.
# (The SQLite driver, libsql, ships N-API prebuilds for both glibc AND musl, so
# it alone no longer forces glibc — but argon2 still does; don't switch to
# alpine without benchmarking argon2 there.) Node 22.x (>=22.12) also satisfies
# Angular's require(ESM); libsql's N-API binding is ABI-stable across Node majors.
# --------------------------------------------------------------------------

# ---------- stage 1 : build ----------
FROM node:22-bookworm-slim AS build

WORKDIR /workspace
ENV NX_DAEMON=false
# Suppress @scarf/scarf install-time telemetry pulled in transitively via
# @nestjs/swagger → swagger-ui-dist (TASK-2170). Setting these env vars (rather
# than `npm ci --ignore-scripts`) disables the beacon deterministically while
# still letting argon2's install script fetch its prebuilt native binary — see
# the argon2 note above; --ignore-scripts would skip that and break the runtime.
ENV SCARF_ANALYTICS=false
ENV DO_NOT_TRACK=1

# Toolchain for any native module that has to compile from source.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Deterministic install from the committed lock. Include .npmrc so `npm ci` uses
# the same peer-resolution mode (legacy-peer-deps) the lockfile was generated
# with — otherwise strict mode reports the lockfile as out-of-sync.
COPY package.json package-lock.json .npmrc nx.json tsconfig.base.json ./
COPY apps ./apps
COPY libs ./libs

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# NOTE: the OpenAPI codegen step (`nx run api-client:generate`) lands with
# STORY-0500; until then the frontend builds against the committed, hand-authored
# @openbucket/api-client source (resolved via the tsconfig path alias).
RUN npx nx build openbucket-frontend --configuration=production
RUN npx nx build openbucket-backend

# Stage the SPA where the backend's ServeStaticModule looks for it at runtime:
# SPA_ROOT = join(dirname(main.js), '..', 'spa'). The Angular `application`
# builder emits the browser bundle under <outputPath>/browser.
RUN mkdir -p /workspace/spa \
 && cp -R dist/apps/openbucket-frontend/browser/. /workspace/spa/

# Drop dev dependencies for the runtime stage.
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev


# ---------- stage 2 : runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=9000 \
    UV_THREADPOOL_SIZE=16 \
    NODE_OPTIONS=--enable-source-maps

# Non-root runtime user; /data is the single host-mounted volume.
RUN useradd -r -u 10001 -d /home/openbucket -m openbucket \
 && mkdir -p /data \
 && chown openbucket:openbucket /data

WORKDIR /app

# Backend dist → /app/dist (so main.js is /app/dist/main.js); SPA → /app/spa
# (so SPA_ROOT = /app/dist/../spa resolves). Prod-only node_modules carries the
# externalized runtime deps (libsql N-API binding, argon2, etc.).
COPY --from=build --chown=openbucket:openbucket /workspace/dist/apps/openbucket-backend ./dist
COPY --from=build --chown=openbucket:openbucket /workspace/spa ./spa
COPY --from=build --chown=openbucket:openbucket /workspace/node_modules ./node_modules
COPY --from=build --chown=openbucket:openbucket /workspace/package.json ./package.json

USER openbucket

EXPOSE 9000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/api/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/main.js"]
