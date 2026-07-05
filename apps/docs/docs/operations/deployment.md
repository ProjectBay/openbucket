---
title: Deployment
description: Run OpenBucket in production — the Docker image, docker-compose, required env, the data volume, a reverse proxy, a Kubernetes sketch, and health checks.
sidebar_position: 1
---

# Deployment

**What you'll do:** run the standalone OpenBucket container in production, with a
persistent data volume, real secrets, and health checks — then put it behind TLS.

## The minimal working deployment

A `docker-compose.yml` with one persistent volume is the fastest real deployment:

```yaml
services:
  openbucket:
    image: ghcr.io/projectbay/openbucket:latest
    restart: unless-stopped
    ports:
      - "9000:9000"
    env_file:
      - .env
    environment:
      DATA_DIR: /data          # the mounted volume — overrides any DATA_DIR in .env
    volumes:
      - openbucket-data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:9000/api/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3

volumes:
  openbucket-data:
```

Generate the secrets, then start it:

```bash
# 1. argon2id hash for the admin password
node scripts/hash-password.mjs 'choose-a-strong-password'

# 2. fill in .env (see the required vars below), then:
docker compose up -d
```

OpenBucket now listens on **`http://localhost:9000`**:

- **S3 API** — `http://localhost:9000` (path-style)
- **Admin console** — `http://localhost:9000/admin`
- **Admin API** — `http://localhost:9000/api/admin`
- **Health / readiness** — `/api/admin/health`, `/api/admin/ready`

:::note[Where the image comes from]
The standalone server image is published to **`ghcr.io/<owner>/openbucket`** on
every `v*` release tag, with `:latest`, `:{major}.{minor}`, and exact `:{version}`
tags (plus `linux/amd64` and `linux/arm64`). Pin an exact version in production;
use `:latest` only for trials. To build locally instead, use the repo's
`Dockerfile` (`docker compose up --build`).
:::

## Required environment

OpenBucket **validates its environment on boot and refuses to start** if anything
is missing or weak. The five required variables:

| Variable | Notes |
| --- | --- |
| `DATA_DIR` | Absolute path to the data volume (no trailing slash). Holds the SQLite DB, blobs, and `sse.key`. |
| `JWT_SECRET` | ≥ 32 chars, high-entropy. Signs admin JWTs. `openssl rand -base64 48`. |
| `ADMIN_PASSWORD_HASH` | argon2id hash — `node scripts/hash-password.mjs '<password>'`. |
| `ROOT_ACCESS_KEY_ID` | 16–32 uppercase alphanumerics. |
| `ROOT_SECRET_ACCESS_KEY` | ≥ 32 chars, high-entropy. |

Common optional ones:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `9000` | HTTP listen port. |
| `ADMIN_USERNAME` | `admin` | Admin login. |
| `OPENBUCKET_REGION` | `us-east-1` | Region reported to clients; match it in your SDK. |
| `OPENBUCKET_SSE_KEY` | generated | base64 of 32 bytes; else generated to `<DATA_DIR>/sse.key`. |
| `KEY_ENCRYPTION_SECRET` | root secret | KEK for scoped sub-key secrets. Set it to decouple from the root key. |
| `SHUTDOWN_DRAIN_MS` | `30000` | Grace period to drain in-flight requests on `SIGTERM`. |

The full, commented list lives in `.env.example` at the repo root (webhooks,
replication, tiering, backups, metrics, analytics, and the DoS-guard limits). See
the [configuration reference](../reference/nestjs-module.md) for every key.

:::warning[Weak secrets fail the boot, on purpose]
A short, all-same-character, or known-placeholder value for `JWT_SECRET` /
`ROOT_SECRET_ACCESS_KEY` is rejected at startup (not a warning — a hard refusal).
Generate real random values.
:::

## The data volume

Everything OpenBucket persists lives under `DATA_DIR` — see
[storage layout](../concepts/storage-layout.md). Two rules:

- **Mount all of `DATA_DIR` as one volume.** The atomic write path renames from
  `DATA_DIR/tmp` into `DATA_DIR/blobs`, which is only atomic within a single
  filesystem. Don't bind-mount subdirectories separately.
- **Back it up as a unit.** The SQLite DB and the blob tree must stay consistent
  with each other; snapshot them together (or use the built-in
  [scheduled backups](../concepts/durability.md#backups-point-in-time-snapshots)).

The container runs as a **non-root** user and exposes port **9000**, so the volume
must be writable by that user.

## Behind a reverse proxy (TLS)

Terminate TLS at a proxy (nginx, Caddy, Traefik, an ALB) and forward to port 9000.
OpenBucket speaks the S3 protocol, so the proxy must **not** buffer or rewrite
request bodies, and must forward the client's scheme and host so SigV4 and
presigned URLs verify:

```nginx
server {
  listen 443 ssl;
  server_name storage.example.com;

  # SigV4 signs the Host + path; presigned URLs sign the scheme too.
  proxy_set_header Host              $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

  # Raw, unbuffered bodies — the S3 protocol needs them, and large uploads
  # must not be spooled to disk by the proxy.
  proxy_request_buffering off;
  client_max_body_size    0;      # don't cap upload size at the proxy

  location / {
    proxy_pass http://127.0.0.1:9000;
  }
}
```

Set `OPENBUCKET_ENDPOINT=storage.example.com` so the store reports a DNS-safe
public hostname for endpoint discovery.

:::info[Embedding under a path prefix]
When you embed `@openbucket/nestjs` instead of running the container, everything
mounts under `mountPath` (default `/storage`) — the S3 endpoint is
`http(s)://<host>/storage`, the admin API is `<mountPath>/api/admin`, and the
console is `<mountPath>/admin`. Your proxy just needs to forward that path prefix
to your app. See the [NestJS module reference](../reference/nestjs-module.md).
:::

## A minimal Kubernetes sketch

OpenBucket is single-node (one writer over SQLite + a local blob tree), so run it
as a **single-replica** Deployment (or a StatefulSet) with a persistent volume —
not a horizontally-scaled Deployment.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openbucket
spec:
  replicas: 1                       # single-node — do NOT scale out
  strategy:
    type: Recreate                  # never two pods on the one RWO volume
  selector:
    matchLabels: { app: openbucket }
  template:
    metadata:
      labels: { app: openbucket }
    spec:
      containers:
        - name: openbucket
          image: ghcr.io/projectbay/openbucket:latest
          ports:
            - containerPort: 9000
          envFrom:
            - secretRef: { name: openbucket-secrets }   # JWT_SECRET, ROOT_*, ADMIN_PASSWORD_HASH…
          env:
            - name: DATA_DIR
              value: /data
          volumeMounts:
            - name: data
              mountPath: /data
          livenessProbe:
            httpGet: { path: /api/admin/health, port: 9000 }
            periodSeconds: 30
          readinessProbe:
            httpGet: { path: /api/admin/ready, port: 9000 }
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: openbucket-data     # a ReadWriteOnce PVC
```

Call `app.enableShutdownHooks()` (the standalone image already does) so a
`SIGTERM` from a rolling update drains in-flight requests before the process exits.

## Health checks

Two **unauthenticated** probes are built in — orchestrators hit them without
credentials:

| Endpoint | Meaning | Response |
| --- | --- | --- |
| `GET /api/admin/health` | **Liveness** — the process is up and the event loop responds. | `200` `{ "status": "ok", "uptime": <s> }` |
| `GET /api/admin/ready` | **Readiness** — the process can serve traffic now. | `200` `{ "status": "ready" }`, or `503` `{ "status": "draining" }` during shutdown. |

Wire liveness to `/api/admin/health` and readiness to `/api/admin/ready` so a
draining pod is pulled from the load balancer before it stops accepting work.
(Under an embedded `mountPath`, these are at `<mountPath>/api/admin/health` and
`/ready`.)

## Next steps

- [Monitoring](./monitoring.md) — probes, Prometheus metrics, structured logs, and the audit log.
- [Upgrading](./upgrading.md) — how to move between versions safely.
- [Storage layout](../concepts/storage-layout.md) — what's on the data volume.
- [Configuration reference](../reference/nestjs-module.md) — every environment variable and option.
