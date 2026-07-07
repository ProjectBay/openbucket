---
title: Is OpenBucket for you?
description: An honest fit guide — when a single-node, S3-compatible object store you embed in your app is the right choice, and when to reach for a distributed store instead.
sidebar_position: 1.5
---

# Is OpenBucket for you?

OpenBucket is a **single-node** S3-compatible object store: one Node.js process
over SQLite and the local filesystem. That design is a deliberate trade — it's
what makes OpenBucket small enough to `docker run` in one command or embed
directly inside your NestJS app, and it's why it is **not** a drop-in
replacement for a distributed object store. Be honest with yourself about which
side of that line you're on.

## OpenBucket is a great fit when…

- **You want S3 semantics without operating a cluster.** One container, one
  volume, any S3 SDK. No MinIO cluster to run, no AWS bill, no second service to
  babysit.
- **You're building an app and need a file backend.** The
  [`@openbucket/nestjs`](./getting-started/quickstart-embed.md) library runs
  _inside your process_ — one-line multer uploads, presigned browser POST,
  in-process `@OnObjectCreated()` events, and on-the-fly image transforms. A
  remote S3 can't do these in-process.
- **Your durability needs are "one node, plus a copy off the box."** OpenBucket
  writes atomically, stores a SHA-256 per object, gates every read against it,
  and scrubs for bit-rot in the background. For off-box durability you turn on
  [async replication](./guides/replication-and-tiering.md) to real S3 / R2 / B2
  / MinIO. That's your redundancy story — see below.
- **You're self-hosting for cost, sovereignty, air-gap, dev/test, or edge** and
  a single well-run node with backups and a replica is an appropriate amount of
  durability for the data.
- **You want small-to-moderate volumes** that fit comfortably on one machine's
  disk and one SQLite metadata database.

## OpenBucket is _not_ the right choice when…

- **You need built-in multi-node durability or high availability.** There is
  **no clustering, sharding, or automatic failover.** The node is a single point
  of failure for _availability_; if it's down, your store is down until it's
  back. Replication gives you a durable second copy, not automatic HA. If you
  require multi-node quorum durability out of the box, use AWS S3, Cloudflare R2,
  or a MinIO cluster.
- **You need the eleven-nines, multi-AZ durability SLA of a hyperscaler.**
  OpenBucket's durability is as good as your disk, your fsync, your backups, and
  your replica — all of which you operate. We tell you exactly how the bytes are
  protected ([Durability](./concepts/durability.md)) so you can decide if that's
  enough. We do not offer a durability SLA.
- **You need virtual-host-style addressing or region emulation.** Path-style
  only (`forcePathStyle: true`), one configured region, no cross-region
  redirects.
- **You need S3 features we don't implement.** `SelectObjectContent` and
  `GetObjectTorrent` return `NotImplemented`; accelerate / logging /
  request-payment / website subresources are recognized stubs, not production
  features. See the [compatibility matrix](./reference/s3-compatibility.md).
- **You're at very large scale** — tens of TB / high-concurrency multi-tenant
  workloads that outgrow a single node and one SQLite metadata plane.

## Running it safely, whatever your case

Even where OpenBucket fits, treat it like the stateful, single-node system it
is: put it behind a TLS-terminating reverse proxy, keep all of `DATA_DIR` on one
filesystem (atomic renames depend on it), turn on
[scheduled backups](./guides/backup-and-restore.md) and, for anything you can't
afford to lose, [replication](./guides/replication-and-tiering.md) to a second
target.

:::info Pre-1.0 status
OpenBucket is pre-1.0. The S3 surface and admin console are feature-complete and
tested against a [conformance suite](./reference/s3-compatibility.md), and a
[security audit](./concepts/security-audit-2026.md) has been completed and
remediated — but APIs may still change before 1.0. See the
[roadmap](./roadmap.md) for what's stable and what may still move.
:::
