---
title: Architecture
description: How OpenBucket fits together — one Node process running NestJS, MikroORM/libsql, the local filesystem, and an Angular admin console.
sidebar_position: 1
---

# Architecture

**What you'll learn:** how OpenBucket is put together, and where to read the full design when you want the deep dive.

## The one-sentence version

OpenBucket is a **single Node.js process**. There is no cluster to stand up, no
sidecar database, no object-storage backend to point it at — you give it one
directory and a port.

```text
                    ┌─────────────────────────── one Node process ───────────────────────────┐
   S3 SDKs  ─────►  │  NestJS 11  ──►  MikroORM 6 / libsql (SQLite)  ── metadata ──►  DATA_DIR │
   Admin console ►  │      │                                                          (SQLite  │
   Prometheus  ──►  │      └──►  local filesystem (blob payloads, atomic writes) ───►  + blobs)│
                    │  Angular 21 admin SPA served as static assets                            │
                    └─────────────────────────────────────────────────────────────────────────┘
```

- **NestJS 11** serves the whole HTTP surface — the S3 wire protocol, the JSON
  admin API, health/readiness probes, and (optionally) a Prometheus endpoint.
- **MikroORM 6** over **libsql** (an embedded SQLite driver) holds all metadata:
  buckets, object rows, versions, access keys, audit events. The database is one
  file, `<DATA_DIR>/openbucket.db`, in WAL mode with `synchronous = FULL`.
- **The local filesystem** stores blob payloads under `<DATA_DIR>/blobs/`,
  written atomically (stage in `tmp/`, fsync, rename).
- **Angular 21** ([Spartan UI](https://spartan.ng)) is the admin console, built
  ahead of time and served as static assets from the same process.

That's the whole runtime. Metadata lives in SQLite; bytes live on disk; one
process ties them together.

## The two shapes, one codebase

The embeddable library, [`@openbucket/nestjs`](../reference/nestjs-module.md),
contains the **entire** S3 + admin + persistence implementation. The standalone
Docker image (`apps/openbucket-backend`) is a **thin deployment shell** that
bundles that library and serves it on its own port.

So the container and the embedded module run **exactly the same code** — the only
difference is who owns the Node process and where config comes from (environment
variables for standalone, `OpenBucketModule.forRoot({ … })` in code for embedded).

:::info No horizontal scale-out (yet)
OpenBucket is a **single-node** store: SQLite plus a local blob tree assume one
writer. You scale it **up** (bigger disk, more CPU) and make it **durable**
(backups, async replication to an S3 target), not **out** across nodes. See
[Durability](./durability.md) for what that buys you.
:::

## The whitepaper

The design is documented in depth in the **implementation whitepaper**:

1. [Backend architecture & bootstrap](../whitepaper/01-backend-architecture.md)
2. [S3 wire protocol & SigV4](../whitepaper/02-s3-protocol-and-sigv4.md)
3. [Persistence & storage layer](../whitepaper/03-persistence-and-storage.md)
4. [Streaming I/O, concurrency & background work](../whitepaper/04-streaming-and-concurrency.md)
5. [Admin API, frontend, auth flow & delivery](../whitepaper/05-admin-frontend-auth-delivery.md)

## Repository layout

OpenBucket is an [Nx](https://nx.dev) monorepo:

```text
apps/
  openbucket-backend/       Thin deployment shell → bundles the library into the Docker image
  openbucket-backend-e2e/   End-to-end tests against the spawned app
  openbucket-frontend/      Angular admin console (Spartan UI)
  conformance/              S3 protocol conformance suite
  docs/                     This documentation site (Docusaurus)
libs/
  nestjs/                   @openbucket/nestjs — the publishable, embeddable module (incl. persistence)
  api-client/               Generated TypeScript client for the admin API
docs/                       Whitepaper source + project-management corpus
```

## Next steps

- [Security model](./security-model.md) — SigV4, admin JWT, scoped keys, and how requests get authorized.
- [Durability](./durability.md) — atomic writes, integrity scrubbing, replication, and backups.
- [Storage layout](./storage-layout.md) — exactly what lands in `DATA_DIR`.
- [Deployment](../operations/deployment.md) — run the container in production.
- [Contributing](../contributing.md) — set up the monorepo and send a change.
