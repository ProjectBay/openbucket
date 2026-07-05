---
title: Replication and tiering
description: Mirror objects one-way to an external S3 target with a durable outbox, tier cold objects off-box with transparent read-through, and reconcile drift.
sidebar_position: 7
---

# Replication and tiering

Keep a live copy of every object on an external S3-compatible target (AWS S3,
Cloudflare R2, Backblaze B2, MinIO), and — optionally — offload cold objects to
that same target while still serving them transparently on read. Both features
share one remote target and are off by default.

:::info One-way, not a cluster
Replication is **asynchronous, one-way mirroring** of your visible object state
to a remote target. It is not multi-primary clustering, not a quorum, and not a
read replica you can serve from. OpenBucket stays the single source of truth; the
target is a durable copy.
:::

## Turn on replication (the copy-paste version)

### Standalone (env)

```bash
OB_REPLICATION_ENABLED=true
OB_REPLICATION_BUCKET=openbucket-mirror
OB_REPLICATION_ACCESS_KEY_ID=...
OB_REPLICATION_SECRET_ACCESS_KEY=...
OB_REPLICATION_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com  # omit for AWS S3
OB_REPLICATION_REGION=us-east-1
OB_REPLICATION_FORCE_PATH_STYLE=true   # true for MinIO/R2/B2; false for AWS S3
```

`OB_REPLICATION_BUCKET` and both credentials are required when replication is on —
a partial config fails at boot. The target bucket must already exist.

### Embedded (`forRoot`)

```ts
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  // ...rootCredentials, admin...
  replication: {
    bucket: 'openbucket-mirror',
    credentials: {
      accessKeyId: process.env.OB_REPLICATION_ACCESS_KEY_ID!,
      secretAccessKey: process.env.OB_REPLICATION_SECRET_ACCESS_KEY!,
    },
    endpoint: 'https://<accountid>.r2.cloudflarestorage.com', // omit for AWS S3
    forcePathStyle: true,
  },
});
```

Omit the `replication` block entirely to disable it — the outbox stays empty and
the drain worker no-ops at zero cost.

## How replication stays durable

Every committed `PUT` / `DELETE` enqueues a **durable intent** in the same
database transaction that commits the object — a transactional **outbox**. A
background drain worker then mirrors those intents to the remote:

- **Per-key ordering** — writes to the same key replicate in order.
- **Last-writer-wins coalescing** — a burst of writes to one key collapses to the
  latest state.
- **Retry with exponential backoff** — a transient remote failure is retried up
  to a **dead-letter cap** (`OB_REPLICATION_MAX_ATTEMPTS`, default 12).
- **Resume on boot** — the worker picks up pending intents after a restart and
  survives remote outages: nothing is lost, it just backs up in the outbox and
  drains when the remote returns.

Tuning knobs: `OB_REPLICATION_DRAIN_INTERVAL_MS` (default 5000),
`OB_REPLICATION_BATCH_KEYS` (distinct keys per tick, default 50), and
`OB_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES` (switch to multipart streaming above
this size, default 64 MiB).

:::warning The wire carries plaintext
The worker sends object **plaintext** (SSE-S3 is decrypted before the object
leaves the box). Use an `https` endpoint — a plaintext `http://` endpoint logs a
boot-time warning because replicated bytes would traverse the network
unencrypted. `http` is tolerated only for a trusted LAN (e.g. a local MinIO).
:::

## Check status and reconcile

```bash
# Read model — enabled flag, outbox depth, last-drain info (always 200)
curl -sS http://localhost:9000/api/admin/replication/status \
  -H "Authorization: Bearer $ADMIN_JWT"
```

If the remote and local ever drift (a backlog cleared during a long outage, a
manual remote change), run a **reconcile** — it scans local vs remote and
re-enqueues anything missing:

```bash
# Whole instance; add {"bucket":"acme-data"} to scope it to one bucket
curl -sS -X POST http://localhost:9000/api/admin/replication/reconcile \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' -d '{}'
```

Reconcile is **single-flight** — a second concurrent request while a job is active
returns `409 Conflict`. Poll a job with `GET /api/admin/replication/reconcile/{jobId}`.
The console's **Replication** page surfaces the same status and a reconcile
trigger. No remote endpoint or credential is ever returned or logged.

## Cold-object tiering

Tiering offloads rarely-accessed objects to that **same remote target** and
rehydrates them transparently when someone reads them. It's driven by per-bucket
lifecycle **transition** rules, and configured with its own env block.

Enable it:

```bash
OPENBUCKET_TIER_ENABLED=true
OPENBUCKET_TIER_INLINE_MAX_BYTES=...          # at/under this size, proxy on read; larger ⇒ presigned redirect
OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS=30000
OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE=8
OPENBUCKET_TIER_PRESIGN_TTL_SECONDS=300
```

Then add a lifecycle **transition** rule to a bucket (via its lifecycle editor /
the S3 lifecycle API) that moves objects to a cold storage class after N days —
the transition target may be `STANDARD_IA`, `GLACIER`, or `DEEP_ARCHIVE`. When a
rule fires, the sweep runner:

1. streams the local plaintext blob to the remote,
2. confirms durability, and
3. **only then** flips the object to a remote stub and soft-deletes the local
   blob — in one transaction.

Ordering is the safety property: a crash before the swap simply leaves the object
local and it's retried. Nothing is lost.

### Transparent read-through

A `GET` for a tiered object just works. OpenBucket fetches the bytes back from the
remote, stages them through its two-phase writer, **verifies the integrity
digest**, and flips the object back to local. Concurrent reads of the same key
rehydrate **once** (single-flight), and both global rehydrate concurrency and
local free space are bounded so a hot key — or a lying remote — can't exhaust the
box. Objects at or under `OPENBUCKET_TIER_INLINE_MAX_BYTES` are proxied inline;
larger objects are served via a short-lived presigned redirect to the remote.

:::note Tiering is env-only and needs a remote
There's no `forRoot` option for tiering — configure it with the `OPENBUCKET_TIER_*`
environment variables. Tiering reuses the replication target, so a remote must be
configured; with no remote the feature reports disabled and both offload and
read-through are inert (a single-node install behaves exactly as before).
:::

:::warning Cold reads are slower and metered
A read of a tiered object pays a remote round-trip (and, for `GLACIER` /
`DEEP_ARCHIVE`-class targets, whatever retrieval latency and cost that tier
imposes). Tier objects you rarely read — not your hot path.
:::

## Next steps

- [Backup and restore](./backup-and-restore.md) — push scheduled snapshots to this same target.
- [Securing OpenBucket](./securing-openbucket.md) — TLS to the target, integrity scrubbing, secrets.
- [NestJS module reference](../reference/nestjs-module.md) — the full `replication` option list.
