---
sidebar_position: 5
title: Architecture
---

# Architecture

OpenBucket is a single Node.js process: **NestJS 11** for the HTTP surface,
**MikroORM 6** over **libsql** (SQLite) for metadata, the local filesystem for
blob payloads, and an **Angular 21** ([Spartan UI](https://spartan.ng)) admin
console served as static assets.

## The whitepaper

The design is documented in depth in the **[implementation whitepaper](./whitepaper/01-backend-architecture.md)**:

1. [Backend architecture & bootstrap](./whitepaper/01-backend-architecture.md)
2. [S3 wire protocol & SigV4](./whitepaper/02-s3-protocol-and-sigv4.md)
3. [Persistence & storage layer](./whitepaper/03-persistence-and-storage.md)
4. [Streaming I/O, concurrency & background work](./whitepaper/04-streaming-and-concurrency.md)
5. [Admin API, frontend, auth flow & delivery](./whitepaper/05-admin-frontend-auth-delivery.md)

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

## How the two shapes share one codebase

The embeddable library, [`@openbucket/nestjs`](./embedding.md), contains the
entire S3 + admin + persistence implementation. The standalone Docker image is a
**thin deployment shell** (`apps/openbucket-backend`) that bundles that library
and serves it on its own port — so the container and the embedded library run
exactly the same code.

## Contributing

Contributions are welcome — see [Contributing](./contributing.md) and the
[Code of Conduct](https://github.com/ProjectBay/openbucket/blob/main/CODE_OF_CONDUCT.md).
Found a security issue? See
[`SECURITY.md`](https://github.com/ProjectBay/openbucket/blob/main/SECURITY.md) —
please report it privately.
