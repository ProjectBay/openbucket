---
sidebar_position: 1
title: Introduction
slug: /intro
description: OpenBucket is a self-hosted, S3-compatible object store you can run as a container — or embed directly into a NestJS app.
---

# OpenBucket

**A self-hosted, S3-compatible object store you can run as a container — or embed directly into a NestJS app.**

OpenBucket speaks the **Amazon S3 wire protocol** (SigV4 auth, presigned URLs,
multipart uploads, versioning, object lock, lifecycle, CORS, tagging, bucket
policies) from a **single Node.js process** backed by SQLite and the local
filesystem. It ships with a JSON **admin API** and a polished **Angular admin
console** — no MinIO cluster, no AWS bill, no second service to babysit.

It comes in two shapes from one codebase:

- 🐳 **Standalone** — a small Docker image / Node app. Point any S3 SDK at it.
  → [**Run it with Docker**](./getting-started/quickstart-docker.md)
- 📦 **Embeddable library** — [`@openbucket/nestjs`](https://www.npmjs.com/package/@openbucket/nestjs).
  Call `OpenBucketModule.forRoot({ … })` and mount a complete object store
  (S3 + admin API + admin console) **inside your own NestJS app**.
  → [**Embed it in NestJS**](./getting-started/quickstart-embed.md)

:::tip[New here? Store your first file in 5 minutes.]
The [**first upload**](./getting-started/first-upload.md) tutorial takes you from
zero to "an uploaded file with a shareable URL" — the thing most apps actually need.
Weighing it up first? [**Is OpenBucket for you?**](./is-openbucket-for-you.md) lays
out where it fits and where it doesn't.
:::

![The OpenBucket admin console — the dashboard, with buckets, usage, and health at a glance](/img/admin_dashboard.png)

## Why OpenBucket

The pitch is simple: **it's the file backend for your app.** Because it can run
*inside your process*, it does things a remote S3 can't.

- **Uploads, handled.** A one-line [multer engine](./guides/file-uploads.md),
  `uploadFrom()` helpers, and [presigned POST](./guides/file-uploads.md) for direct
  browser uploads.
- **Serve smart.** [On-the-fly image transforms](./guides/image-transforms.md)
  (`?w=&h=&format=webp`) with a cached derivative store.
- **React to changes.** In-process `@OnObjectCreated()`
  [events + signed webhooks](./guides/events-and-webhooks.md).
- **Multi-tenant ready.** [Scoped access keys](./guides/multi-tenancy.md) restricted
  to a bucket/prefix, plus admin roles.
- **Durable.** [Async replication](./guides/replication-and-tiering.md) to real
  S3 / R2 / B2, cold-object tiering, [scheduled backups](./guides/backup-and-restore.md),
  and background integrity scrubbing.
- **Production-ready.** [Prometheus `/metrics`](./guides/observability.md), an
  [audit log](./guides/admin-console.md), a [CLI](./guides/cli.md), and a
  [security posture](./guides/securing-openbucket.md) that's been through an audit.

## Where to go next

| If you want to… | Start here |
| --- | --- |
| Get it running fast | [Quick start (Docker)](./getting-started/quickstart-docker.md) · [Quick start (NestJS)](./getting-started/quickstart-embed.md) |
| Understand the pieces | [Core concepts](./getting-started/core-concepts.md) |
| Do a specific thing | [Guides](./guides/file-uploads.md) — uploads, transforms, events, sharing, multi-tenancy, backups, replication, observability, CLI |
| Look something up | [Reference](./reference/configuration.md) — config, the `OpenBucketService` API, S3 compatibility, CLI, admin API |
| Learn how it works | [Concepts](./concepts/architecture.md) & the [whitepaper](./whitepaper/00-front-matter.md) |
| Run it in production | [Operations](./operations/deployment.md) — deploy, monitor, upgrade |

:::note[Status]
OpenBucket is **pre-1.0** and under active development. The S3 surface and admin
console are feature-complete and tested; APIs may still change before 1.0. The
library publishes to the npm **`next`** dist-tag — `npm install @openbucket/nestjs@next`.
:::

:::info[Trademark]
OpenBucket is an independent project and is not affiliated with or endorsed by
Amazon Web Services. "Amazon S3" and "AWS" are trademarks of Amazon.com, Inc.
"S3-compatible" describes wire-protocol compatibility only.
:::
