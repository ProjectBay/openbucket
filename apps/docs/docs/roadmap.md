---
title: Roadmap
description: What's stable in OpenBucket today, what may still change before 1.0, and how to influence the direction.
sidebar_position: 8
---

# Roadmap

OpenBucket is **pre-1.0 and under active development**. This page is the honest
picture of what you can rely on today and what may still move before 1.0, so you
can decide how to adopt.

## Stable today

These are feature-complete and covered by tests / the
[conformance suite](./reference/s3-compatibility.md):

- **S3 wire protocol** — path-style addressing, SigV4 (header + presigned query),
  streaming PUT/GET, multipart uploads, object & bucket tagging, versioning,
  object lock (governance/compliance + legal hold), SSE-S3 encryption, lifecycle
  expiration, CORS, and bucket policies.
- **Admin API + console** — the JSON admin API and the bundled Angular console
  (bucket/object browser, search, preview, access-key & multi-admin management,
  usage analytics, audit log).
- **Embedding** — the [`@openbucket/nestjs`](./getting-started/quickstart-embed.md)
  module, `OpenBucketService`, the multer engine, presigned POST, and in-process
  object events.
- **Durability & operations** — [replication](./guides/replication-and-tiering.md),
  cold-object tiering, [backup & restore](./guides/backup-and-restore.md), the
  integrity scrubber, Prometheus `/metrics`, and health/readiness probes.
- **Security** — remediated per the [2026 security audit](./concepts/security-audit-2026.md).

## Stabilizing before 1.0

The **behavior** above is stable; what may still change before 1.0 is at the
edges:

- **Public API surface** — method signatures on `OpenBucketService` and the
  `OpenBucketModule` options may be refined. Breaking changes are called out in
  the [CHANGELOG](https://github.com/ProjectBay/openbucket/blob/main/CHANGELOG.md).
- **Admin API / generated client** — endpoint shapes may still evolve.
- **Configuration** — environment-variable names and defaults may be consolidated.

## The 1.0 bar

We consider OpenBucket 1.0 when:

- The public library + admin API surfaces are frozen under semver.
- The S3 compatibility matrix is backed by a machine-generated, dated conformance
  report.
- A stable release sits on the npm `latest` tag (not a pre-release).

## What OpenBucket is deliberately _not_ doing

To keep the "one process, one volume" promise, multi-node clustering, sharding,
and quorum HA are **out of scope** — that's a different kind of system. For
durability beyond a single node, OpenBucket replicates and tiers to an external
S3-compatible target. See [Is OpenBucket for you?](./is-openbucket-for-you.md).

## Influence the direction

- 🗳️ **Feature requests & discussion** →
  [GitHub Discussions](https://github.com/ProjectBay/openbucket/discussions)
- 🐛 **Bugs** →
  [Issues](https://github.com/ProjectBay/openbucket/issues)
- 🤝 **Contributions** are welcome — see
  [Contributing](./contributing.md).
