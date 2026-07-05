---
title: Configuration
description: Every OpenBucket setting — standalone environment variables and the forRoot module options — with defaults, requirements, and notes.
sidebar_position: 1
---

# Configuration

Every knob OpenBucket exposes, in one place. The **standalone** app reads its
config from the environment; the **embedded** module (`OpenBucketModule.forRoot`)
takes the same settings as typed options. Both **fail fast** — a missing or
malformed secret refuses to boot rather than starting insecure.

Grab the essentials and go:

```bash
# The five required standalone settings:
DATA_DIR=/data
JWT_SECRET=$(openssl rand -base64 48)
ADMIN_PASSWORD_HASH=$(node scripts/hash-password.mjs 'your-admin-password')
ROOT_ACCESS_KEY_ID=AKIAEXAMPLE000000000
ROOT_SECRET_ACCESS_KEY=$(openssl rand -base64 48)
```

Everything else has a sensible default. The full, commented template lives in
[`.env.example`](https://github.com/ProjectBay/openbucket/blob/main/.env.example).

:::tip Generate strong secrets
`JWT_SECRET`, `ROOT_SECRET_ACCESS_KEY`, `KEY_ENCRYPTION_SECRET`, `WEBHOOK_SECRET`,
and a `token`-mode `METRICS_TOKEN` are all validated as **strong secrets**: at
least 32 characters, at least 8 distinct characters, not a single repeated
character, and not a known placeholder (`changeme`, `secret`, `password`, …).
`openssl rand -base64 48` clears the bar every time.
:::

## Standalone environment variables

The standalone app validates `process.env` on boot and **refuses to start** if
anything required is missing or malformed. Unknown variables are ignored.

### Core (required)

| Variable | Required | Default | Notes |
| --- | :-: | --- | --- |
| `DATA_DIR` | ✅ | — | Directory for the SQLite metadata DB, blob payloads, and the generated `sse.key`. No trailing slash. |
| `JWT_SECRET` | ✅ | — | Strong secret (≥ 32 chars). Signs admin JWTs. |
| `ADMIN_PASSWORD_HASH` | ✅ | — | argon2id hash — generate with `node scripts/hash-password.mjs '<password>'`. |
| `ROOT_ACCESS_KEY_ID` | ✅ | — | 16–32 uppercase alphanumerics (`^[A-Z0-9]{16,32}$`). |
| `ROOT_SECRET_ACCESS_KEY` | ✅ | — | Strong secret (≥ 32 chars). The root SigV4 credential. |

### Runtime & admin auth

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | One of `development` / `test` / `production`. |
| `PORT` | `9000` | HTTP listen port. |
| `LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal`. |
| `ADMIN_USERNAME` | `admin` | Bootstrap admin login. |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access-token lifetime (60–3600). |
| `JWT_REFRESH_TTL_SECONDS` | `604800` | Refresh-token lifetime (3600–2592000, i.e. 1 h–30 d). |

### S3 protocol

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENBUCKET_REGION` | `us-east-1` | Region reported to clients. Match it in your SDK config. |
| `OPENBUCKET_ENDPOINT` | — | Optional DNS-safe hostname clients use to reach the store. |
| `OPENBUCKET_SSE_KEY` | generated | base64 of exactly 32 bytes for at-rest SSE-S3. Auto-generated to `<DATA_DIR>/sse.key` on first boot when unset. |
| `KEY_ENCRYPTION_SECRET` | root secret | Strong secret. KEK material for scoped sub-key secrets at rest. Falls back to `ROOT_SECRET_ACCESS_KEY` when unset — so rotating the root secret without setting this invalidates existing sub-key secrets. |

### Limits & quotas

| Variable | Default | Notes |
| --- | --- | --- |
| `MAX_OBJECT_SIZE_MB` | `5120` | Per-object size cap in MiB (5 GiB). Max `5242880`. |
| `MAX_MULTIPART_PARTS` | `10000` | Max parts per multipart upload (also the ceiling). |
| `MULTIPART_TTL_HOURS` | `24` | Abandoned-multipart reaper TTL. |
| `MAX_CONCURRENT_MULTIPART_UPLOADS` | `1000` | Cap on in-flight multipart sessions. `0` = unlimited. |
| `DATA_DIR_MIN_FREE_BYTES` | `104857600` | Refuse writes below this free-space reserve (100 MiB). |
| `STORAGE_QUOTA_BYTES` | `0` | Aggregate stored-byte quota. `0` = disabled. |
| `STORAGE_QUOTA_OBJECTS` | `0` | Aggregate object-count quota. `0` = disabled. |
| `S3_THROTTLE_LIMIT` | `1000` | Per-IP S3 data-plane request budget per window. `0` disables. |
| `S3_THROTTLE_TTL_MS` | `60000` | S3 throttle window. |

### Image transforms

On-the-fly, cached image derivatives (`?w=&h=&fit=&format=&q=`) on GET.

| Variable | Default | Notes |
| --- | --- | --- |
| `IMAGE_TRANSFORM_ENABLED` | `true` | Master switch. `false` makes every GET serve the plain object. |
| `MAX_TRANSFORM_DIMENSION` | `4096` | Max requested output width/height in px. Ceiling `16384`. |
| `MAX_TRANSFORM_INPUT_BYTES` | `52428800` | Refuse to transform a source larger than this (50 MiB). |
| `IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS` | `576000000` | Decoded-canvas ceiling (decompression-bomb guard, 24000×24000). |
| `IMAGE_TRANSFORM_CONCURRENCY` | `4` | Max concurrent `sharp` operations. Max `64`. |
| `DERIVATIVE_CACHE_MAX_BYTES` | `5368709120` | Derivative-cache size ceiling (5 GiB). `0` = unbounded. |

### Analytics & audit

| Variable | Default | Notes |
| --- | --- | --- |
| `USAGE_ROLLUP_INTERVAL_MS` | `900000` | Usage-rollup sample interval (floor `60000`). |
| `USAGE_RETENTION_DAYS` | `90` | Prune usage samples older than this. |
| `AUDIT_RETENTION_DAYS` | `90` | Prune persisted audit rows older than this. |
| `AUDIT_FLUSH_MS` | `2000` | Audit buffer → SQLite flush interval (floor `250`). |
| `AUDIT_BUFFER_MAX` | `10000` | Max buffered audit events before oldest is dropped (min `100`). |

### Object-event webhooks

Setting `WEBHOOK_URL` enables durable, HMAC-signed delivery of object events.
The URL must be `https` unless the host is loopback; the secret is then required.

| Variable | Required | Default | Notes |
| --- | :-: | --- | --- |
| `WEBHOOK_URL` | | — | Target endpoint. Presence enables the delivery outbox. |
| `WEBHOOK_SECRET` | when URL set | — | Strong secret. HMAC-SHA256 signing key. |
| `WEBHOOK_EVENTS` | | all three | Comma-separated: `object.created,object.deleted,multipart.completed`. |
| `WEBHOOK_MAX_ATTEMPTS` | | `8` | Attempts before dead-letter (1–50). |
| `WEBHOOK_TIMEOUT_MS` | | `5000` | Per-request timeout (500–60000). |
| `WEBHOOK_POLL_MS` | | `15000` | Delivery tick interval (1000–300000). |

### Async replication

Mirror every object mutation to an external S3-compatible target. When
`OB_REPLICATION_ENABLED=true`, the bucket and both credentials are **required
together** — a partial config refuses to boot.

| Variable | Required* | Default | Notes |
| --- | :-: | --- | --- |
| `OB_REPLICATION_ENABLED` | | `false` | Master switch. Off ⇒ zero cost, outbox stays empty. |
| `OB_REPLICATION_ENDPOINT` | | — | S3-compatible endpoint (R2/B2/MinIO). Omit for real AWS S3. `http://` warns at boot (plaintext). |
| `OB_REPLICATION_REGION` | | `us-east-1` | Target region. |
| `OB_REPLICATION_BUCKET` | ✅ | — | Remote target bucket (must already exist). |
| `OB_REPLICATION_ACCESS_KEY_ID` | ✅ | — | Target credential. |
| `OB_REPLICATION_SECRET_ACCESS_KEY` | ✅ | — | Target credential (never logged). |
| `OB_REPLICATION_FORCE_PATH_STYLE` | | `true` | `true` for MinIO/S3-compat; `false` for AWS. |
| `OB_REPLICATION_MAX_ATTEMPTS` | | `12` | Dead-letter cap (1–50). |
| `OB_REPLICATION_DRAIN_INTERVAL_MS` | | `5000` | Drain tick interval (1000–300000). |
| `OB_REPLICATION_BATCH_KEYS` | | `50` | Distinct keys drained per tick (1–1000). |
| `OB_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES` | | `67108864` | Stream via multipart above this (64 MiB). |

\* Required only when `OB_REPLICATION_ENABLED=true`.

### Cold-object tiering

Offload cold objects to the replication target and rehydrate transparently on
read. A no-op unless a replication target is also configured.

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENBUCKET_TIER_ENABLED` | `false` | Master switch. |
| `OPENBUCKET_TIER_INLINE_MAX_BYTES` | `268435456` | Proxy read-through at/under this size; larger ⇒ presigned redirect (256 MiB). |
| `OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS` | `30000` | Latency bound on a proxied fetch before `503 SlowDown`. |
| `OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE` | `8` | Global concurrent-rehydration cap. `0` = unlimited. |
| `OPENBUCKET_TIER_PRESIGN_TTL_SECONDS` | `300` | TTL for presigned redirect URLs (30–3600). |

### Scheduled backups

Write a `.zip` snapshot on a schedule with union retention. When
`OB_SCHEDULED_BACKUP_ENABLED=true`, **exactly one** of `INTERVAL_MINUTES` /
`CRON` must be set.

| Variable | Default | Notes |
| --- | --- | --- |
| `OB_SCHEDULED_BACKUP_ENABLED` | `false` | Master switch. |
| `OB_SCHEDULED_BACKUP_SCOPE` | `instance` | `instance` = one snapshot; `buckets` = one per bucket. |
| `OB_SCHEDULED_BACKUP_INTERVAL_MINUTES` | — | Fixed interval (5–43200). Mutually exclusive with `CRON`. |
| `OB_SCHEDULED_BACKUP_CRON` | — | 5-field cron. Mutually exclusive with `INTERVAL_MINUTES`. |
| `OB_SCHEDULED_BACKUP_DIR` | `<DATA_DIR>/backups` | Absolute snapshot directory. |
| `OB_SCHEDULED_BACKUP_KEEP_LAST` | `7` | Keep the newest N snapshots (hard floor, 1–1000). |
| `OB_SCHEDULED_BACKUP_MAX_AGE_DAYS` | `30` | Also keep anything younger than this (union, 1–3650). |
| `OB_SCHEDULED_BACKUP_CHECK_INTERVAL_MS` | `60000` | "Is a snapshot due?" wake tick (10000–3600000). |
| `OB_SCHEDULED_BACKUP_PUSH_TO_REPLICATION` | `false` | Also push each `.zip` to the replication target. |

### Integrity scrubbing

A background scrubber re-hashes local blobs against their stored SHA-256 to
detect bit-rot. Strictly rate-limited so it never starves request traffic.

| Variable | Default | Notes |
| --- | --- | --- |
| `OB_INTEGRITY_SCRUB_ENABLED` | `false` | Master switch. A fresh install does zero extra I/O. |
| `OB_INTEGRITY_SCRUB_INTERVAL_MS` | `60000` | Tick interval (floor `1000`). |
| `OB_INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK` | `1000` | Hard per-tick object cap (min `1`). |
| `OB_INTEGRITY_SCRUB_MAX_BYTES_PER_TICK` | `1073741824` | Per-tick byte budget (1 GiB). |

### Restore caps & shutdown

| Variable | Default | Notes |
| --- | --- | --- |
| `RESTORE_MAX_TOTAL_BYTES` | `107374182400` | Total decompressed payload accepted from a restore archive (100 GiB). |
| `RESTORE_MAX_ENTRY_BYTES` | `5368709120` | Per-entry decompressed cap (5 GiB). |
| `RESTORE_MAX_ENTRIES` | `1000000` | Max payload entries in a restore archive. |
| `RESTORE_MAX_MANIFEST_BYTES` | `4194304` | Max buffered `manifest.json` bytes (4 MiB). |
| `METRICS_MODE` | `off` | Prometheus scrape gate: `off` / `public` / `token`. |
| `METRICS_TOKEN` | — | Strong bearer token — required when `METRICS_MODE=token`. |
| `OTEL_TRACING_ENABLED` | `false` | OpenTelemetry tracing (no-op unless `@opentelemetry/api` + an SDK are installed). |
| `SHUTDOWN_DRAIN_MS` | `30000` | In-flight drain budget on `SIGTERM` (1000–120000). |

## Module options (`forRoot`)

When you embed OpenBucket, pass these to `OpenBucketModule.forRoot(...)` instead
of environment variables. Only `dataDir` and `rootCredentials` are required.

```ts
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  rootCredentials: {
    accessKeyId: process.env.OB_ACCESS_KEY!,
    secretAccessKey: process.env.OB_SECRET_KEY!,
  },
  admin: {
    username: 'admin',
    passwordHash: process.env.OB_ADMIN_HASH!, // argon2id
    jwtSecret: process.env.OB_JWT_SECRET!,
  },
});
```

### Top-level options

| Option | Required | Default | Notes |
| --- | :-: | --- | --- |
| `dataDir` | ✅ | — | SQLite DB + blob payloads + generated `sse.key`. Created on boot if absent. |
| `rootCredentials` | ✅ | — | `{ accessKeyId, secretAccessKey }` — the root SigV4 credential. |
| `mountPath` | | `/storage` | Route prefix for all OpenBucket routes. Path-style only; `''` mounts at the root. |
| `region` | | `us-east-1` | Region reported to clients. |
| `endpoint` | | — | DNS-safe hostname for endpoint discovery / presign defaults. |
| `sseKey` | | generated | base64 of 32 bytes. Else generated + persisted to `<dataDir>/sse.key`. |

### `admin` — the admin surface

Omit the whole block to run a **headless, S3-only** store (no admin API, no JWT
guard, no console). A present-but-partial block is rejected at boot.

| Field | Required | Default | Notes |
| --- | :-: | --- | --- |
| `username` | ✅ | — | Bootstrap admin login. |
| `passwordHash` | ✅ | — | argon2id hash of the admin password. |
| `jwtSecret` | ✅ | — | Strong secret signing admin JWTs. |
| `serveUi` | | `true` | Serve the bundled Angular SPA at `<mountPath>/admin`. |
| `jwtAccessTtl` | | `900` | Access-token TTL in seconds. |
| `jwtRefreshTtl` | | `604800` | Refresh-token TTL in seconds (7 days). |

### `limits`

| Field | Default | Notes |
| --- | --- | --- |
| `maxObjectSizeMb` | `5120000` | Max single-object size in MiB. |
| `maxMultipartParts` | `10000` | Max parts per multipart upload. |
| `multipartTtlHours` | `24` | Abandoned-multipart TTL. |

### `webhooks`

Omit to disable HTTP webhook delivery (in-process `@OnObject*` handlers still
work). Presence of `url` enables the transactional outbox + delivery runner.

| Field | Required | Default | Notes |
| --- | :-: | --- | --- |
| `url` | ✅ | — | Target endpoint. `https` required unless loopback. |
| `secret` | ✅ | — | Strong secret. HMAC-SHA256 signing key. |
| `events` | | all three | Subset of `object.created` / `object.deleted` / `multipart.completed`. |
| `maxAttempts` | | `8` | Attempts before dead-letter. |
| `timeoutMs` | | `5000` | Per-request timeout. |
| `pollMs` | | `15000` | Delivery tick interval. |

### `replication`

Omit to disable. A present-but-partial block is rejected at boot (require
`bucket` + both credentials).

| Field | Required | Default | Notes |
| --- | :-: | --- | --- |
| `bucket` | ✅ | — | Remote target bucket (must already exist). |
| `credentials` | ✅ | — | `{ accessKeyId, secretAccessKey }` for the target. |
| `endpoint` | | — | S3-compatible endpoint. Omit for real AWS S3. |
| `region` | | `us-east-1` | Target region. |
| `forcePathStyle` | | `true` | `true` for MinIO/S3-compat; `false` for AWS. |
| `maxAttempts` | | `12` | Dead-letter cap. |
| `drainIntervalMs` | | `5000` | Drain tick interval. |
| `batchKeys` | | `50` | Distinct keys drained per tick. |
| `largeObjectThresholdBytes` | | `67108864` | Stream via multipart above this (64 MiB). |

### `backups`

Omit to disable. Exactly one of `cron` / `intervalMinutes` must be set.

| Field | Default | Notes |
| --- | --- | --- |
| `scope` | `instance` | `instance` = one snapshot; `buckets` = one per bucket. |
| `cron` | — | 5-field cron. Mutually exclusive with `intervalMinutes`. |
| `intervalMinutes` | — | Fixed interval (minutes). Mutually exclusive with `cron`. |
| `dir` | `<dataDir>/backups` | Absolute snapshot directory. |
| `keepLast` | `7` | Keep the newest N snapshots. |
| `maxAgeDays` | `30` | Also keep anything younger than this. |
| `checkIntervalMs` | `60000` | "Is a snapshot due?" wake tick. |
| `pushToReplication` | `false` | Also push each snapshot to the replication target. |

### `metrics` & `tracing`

| Field | Default | Notes |
| --- | --- | --- |
| `metrics.mode` | `off` | `off` / `public` / `token` — gates `<mountPath>/metrics`. |
| `metrics.token` | — | Strong bearer token — required when `mode: 'token'`. |
| `tracing.enabled` | `false` | OpenTelemetry span wrapping. No-op unless `@opentelemetry/api` + an SDK are present. |

:::info Static options in `forRootAsync`
`mountPath`, `serveUi`, and `admin` (the on/off switch) are **static** — passed
alongside `useFactory` because routing is wired at module-config time. The admin
*secrets* still come from the async factory. See the
[NestJS module reference](./nestjs-module.md#async-configuration).
:::

:::warning Refuse-to-boot validation
Both entry points validate security-critical formats before serving a single
request: a non-argon2id `passwordHash`, a too-short `jwtSecret`, a weak
`rootCredentials.secretAccessKey`, a `token`-mode metrics endpoint behind a weak
token, or an enabled-but-incomplete replication / backup block all abort startup
with a precise message. Fail loud, never silently insecure.
:::

## Next steps

- [OpenBucketService API](./openbucket-service.md) — the in-process facade you inject.
- [NestJS module reference](./nestjs-module.md) — the full embedding guide.
- [S3 compatibility](./s3-compatibility.md) — what the wire protocol supports.
- [Admin API](./admin-api.md) — the JSON admin surface these settings power.
- [CLI reference](./cli-reference.md) — manage a running instance from a terminal.
