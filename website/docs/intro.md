---
sidebar_position: 1
title: Introduction
slug: /intro
---

# OpenBucket

**A self-hosted, S3-compatible object store you can run as a container — or embed directly into a NestJS app.**

OpenBucket speaks the **Amazon S3 wire protocol** (SigV4 auth, presigned URLs,
XML error envelopes, multipart uploads, versioning, object lock, lifecycle,
CORS, tagging, bucket policies) from a single Node.js process backed by SQLite
and the local filesystem. It ships with a JSON **admin API** and a polished
**Angular admin console**.

It comes in two shapes from one codebase:

- 🐳 **Standalone** — a small Docker image / Node app. Point any S3 SDK at it.
- 📦 **Embeddable library** — [`@openbucket/nestjs`](https://www.npmjs.com/package/@openbucket/nestjs).
  Call `OpenBucketModule.forRoot({ … })` and mount a complete object store
  (S3 + admin API + admin SPA) under a path prefix inside your own NestJS app.

:::note Status
Pre-1.0 and under active development. The S3 surface and admin console are
feature-complete and tested; APIs may still change before 1.0.
:::

## Features

**S3 protocol** — path-style addressing, AWS Signature V4 (header + presigned
query), streaming PUT/GET, multipart uploads, object & bucket tagging, bucket
versioning, **object lock** (governance/compliance retention + legal hold),
**SSE-S3 at-rest encryption** (AES-256), lifecycle expiration, CORS, bucket
policies, and S3-style XML error responses.

**Admin** — a JSON admin API (`/api/admin/*`) secured with argon2id passwords +
rotating JWTs, plus an **Angular admin console**: bucket & object browser,
upload/download, presigned share links, access-key management, per-bucket
versioning / encryption / object-lock / lifecycle / CORS / policy editors,
i18n (en/de), and light/dark themes.

**Operations** — refuse-to-boot env validation, forward-only DB migrations on
startup, graceful drain on `SIGTERM`, structured (pino) JSON logs, health &
readiness probes, and request IDs.

**Embeddable** — runs its ORM under an isolated MikroORM context so it won't
collide with a host app's database, mounts everything under a configurable
`mountPath`, and serves the bundled SPA from the package.

## Where to next

- [Getting started](./getting-started.md) — run it with Docker in three commands.
- [Embedding in NestJS](./embedding.md) — add an object store to your own app.
- [Architecture](./architecture.md) — how it's built, and the whitepaper.

:::info Trademark
OpenBucket is an independent project and is not affiliated with or endorsed by
Amazon Web Services. "Amazon S3" and "AWS" are trademarks of Amazon.com, Inc.
"S3-compatible" describes wire-protocol compatibility only.
:::
