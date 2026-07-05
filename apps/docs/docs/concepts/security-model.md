---
title: Security model
description: How OpenBucket authenticates and authorizes every request — SigV4 for S3, admin JWTs over argon2id, scoped keys, bucket-policy evaluation, and secret handling.
sidebar_position: 2
---

# Security model

**What you'll learn:** who is allowed to do what, and how OpenBucket proves it on
every request. There are two planes — the **S3 data plane** (SigV4) and the
**admin plane** (JWT) — and they never share credentials.

## The two planes at a glance

```text
  S3 clients ──►  SigV4Guard  ──►  PolicyAuthorizationGuard  ──►  S3 handler
  (AWS SDK)       verify sig       bucket policy AND key scope

  Admin console ─► JwtAuthGuard ──► RolesGuard ──────────────►  /api/admin/* handler
  (browser)        verify JWT       full-admin vs read-only
```

- **Data plane** — any S3 client authenticates with **AWS Signature V4** using an
  access-key pair. Requests are then authorized by bucket policy **and** the
  key's scope.
- **Admin plane** — the console and CLI authenticate with a **short-lived JWT**
  minted from an argon2id password check, and are authorized by an admin **role**.

## SigV4 for the S3 API

Every S3 request is verified by `SigV4Guard` before any handler runs. It supports
both signing forms AWS SDKs use:

- **Header-signed** requests (`Authorization: AWS4-HMAC-SHA256 …`).
- **Presigned URLs** (the `X-Amz-Signature` query parameter).

The guard:

- **Reverse-computes the signature** from the resolved secret and compares it in
  **constant time** (`crypto.timingSafeEqual`) — a mismatch is a generic
  `SignatureDoesNotMatch`, so a wrong secret and a wrong key look identical.
- **Enforces a ±15-minute clock skew** on `X-Amz-Date` (`RequestTimeTooSkewed`
  beyond that), the AWS default.
- **Requires `host` (and any wire-present `x-amz-*` header) to be signed**, so
  those headers can't be left unbound by a crafted `SignedHeaders` list.
- Accepts the streaming-upload forms `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` (signed
  chunks) and `STREAMING-UNSIGNED-PAYLOAD-TRAILER`; the **signed** trailing-checksum
  form (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER`) is rejected with a clear
  `InvalidArgument`.

:::note[Path-style only]
OpenBucket addresses buckets **path-style** (`host/bucket/key`), never
virtual-host style. Configure your SDK with `forcePathStyle: true` and a region
that matches `OPENBUCKET_REGION` (default `us-east-1`).
:::

## The root key vs scoped sub-keys

The **root** credential (`ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`) is
loaded from the environment at boot, cached in memory, **never persisted**, and is
**always unrestricted**.

On top of it you mint **scoped sub-keys** — full SigV4 access keys confined to a
bucket + key-prefix (or an inline policy) — via `POST /api/admin/keys`:

```ts
const { data } = await keysApi.createKey({
  label: 'tenant-a-uploader',
  scope: { kind: 'prefix', bucket: 'tenants', prefix: 'tenant-a/' },
});
// data.accessKeyId / data.secretAccessKey — returned ONCE; hand them to the tenant.
```

A key minted **with** a scope records `role: 'scoped'`; without one it records
`role: 'root'` (unscoped, root-equivalent).

## How a request gets authorized

After SigV4 proves *who* you are, `PolicyAuthorizationGuard` decides *what* you
may do. The scope you gave a sub-key is compiled once, at mint time, into the same
IAM-style `PolicyDocument` the bucket-policy evaluator already understands. The
effective decision is **bucket policy AND scope**:

- The root key is evaluated with `defaultAllow: true` — a bucket policy without a
  matching statement leaves root's access intact; only an explicit `Deny` blocks it.
- A **scoped** key is evaluated with **implicit deny** (`defaultAllow: false`) —
  an action or resource the scope doesn't `Allow` is denied even when the bucket
  has no policy.
- An explicit bucket-policy **`Deny` always wins** (checked first, never masked).
- A prefix scope grants `s3:ListBucket` only under a `StringLike s3:prefix`
  condition, so a tenant key can't enumerate the whole bucket with an unprefixed
  `ListObjectsV2`.
- A scoped key calling a service-level op (`ListBuckets`) is denied unless its
  scope explicitly allows `s3:ListAllMyBuckets`.

The evaluator understands Action/Resource/Principal globs plus two advertised
conditions — `Bool aws:SecureTransport` and `IpAddress`/`NotIpAddress aws:SourceIp`
— and **fails closed**: an unknown condition operator satisfies a `Deny` but never
grants an `Allow`.

:::tip[Inspect before you ship]
Before handing a scoped key to a tenant, call `getKeyEffectivePermissions(id)` for
an allow/deny matrix, or `simulateKeyAction(id, { action, resource })` for a single
decision — both run through the **same** evaluator the live request path uses, so
the console and production agree.
:::

## Admin auth: JWT over argon2id

The admin plane is protected by a global `JwtAuthGuard` that authenticates every
`/api/admin/*` request (the S3 and SPA trees pass through untouched).

- **Passwords** are verified with **argon2id**. On a username miss, OpenBucket
  runs a constant-time verify against a dummy hash so login timing never reveals
  whether a username exists.
- Login mints a **15-minute access JWT** plus a **rotating refresh token** (7-day
  default). Both TTLs are configurable (`JWT_ACCESS_TTL_SECONDS`,
  `JWT_REFRESH_TTL_SECONDS`).
- JWTs are verified with a fixed `issuer`/`audience`; the signing key is
  `JWT_SECRET` (≥ 32 chars, checked for low entropy and known placeholders at boot).

### Roles are read fresh every request

Admins are **full admin** (`admin`) or **read-only** (`readonly`). A global
`RolesGuard` is **default-deny by HTTP method**: it `403`s any
`POST`/`PUT`/`PATCH`/`DELETE` under `/api/admin/*` for a read-only principal
(except a couple of self-service routes and handlers marked `@AllowReadOnly()`).

The role is read **fresh from the database on every request**, not trusted from
the JWT claim — so demoting an admin takes effect immediately, even while an old
token still verifies. Two anti-lockout invariants always hold: you can't delete or
demote the **last full admin**, and you can't delete your **own** account.

## Secret handling

OpenBucket treats secrets as radioactive:

- **Scoped sub-key secrets are encrypted at rest.** SigV4 needs the plaintext to
  verify a signature, so a sub-key's secret is stored **AES-256-GCM encrypted**
  (`SecretCipher`), never plaintext, and decrypted only on the hot path. The GCM
  auth tag rejects tampering; a tampered blob **fails closed** (the key is treated
  as unknown).
- **The root secret and the SSE key are never persisted as sub-key material** —
  root lives only in memory from the environment.
- **Logs are redacted.** The pino logger censors `password`, `secret`,
  `secretAccessKey`, `token`, `authorization`, `KEY_ENCRYPTION_SECRET`, and
  friends; SigV4 query-auth parameters (`X-Amz-Signature`/`-Credential`/
  `-Security-Token`) are stripped from logged URLs so a presigned request never
  logs a replayable signature. Access-key ids are truncated (`AKIA…-xy`) when logged.
- **The audit log strips secret-looking fields** before persisting an event, and
  drops an oversized `detail` payload — defense in depth on top of a catalogue
  that never carries secrets.

### The reversible key-secret encryption

The 32-byte key-encryption key (KEK) that wraps sub-key secrets is **HKDF-SHA256
derived** from `KEY_ENCRYPTION_SECRET` when set, otherwise from
`ROOT_SECRET_ACCESS_KEY`.

:::warning[Set `KEY_ENCRYPTION_SECRET` up front]
If you rotate `ROOT_SECRET_ACCESS_KEY` **without** having set a dedicated
`KEY_ENCRYPTION_SECRET`, the KEK changes and every existing sub-key secret becomes
undecryptable — those keys must be re-minted. Set a strong `KEY_ENCRYPTION_SECRET`
(≥ 32 chars) from day one to decouple sub-key storage from the root credential.
:::

## At-rest object encryption (SSE-S3)

Objects are optionally encrypted at rest with a **single, backend-managed 32-byte
key** (the SSE-S3 model) using AES-256-CTR — one key for the whole instance, no
per-object derivation, no in-place rotation in v1. Losing the key
(`<DATA_DIR>/sse.key` or `OPENBUCKET_SSE_KEY`) makes every encrypted object
unreadable, so back it up with your other break-glass secrets. See
[Durability](./durability.md) and [Storage layout](./storage-layout.md) for how
the ciphertext and its IV are stored and integrity-checked.

## Next steps

- [Durability](./durability.md) — how the bytes you store stay correct over time.
- [Storage layout](./storage-layout.md) — where secrets and blobs actually live on disk.
- [Configuration reference](../reference/nestjs-module.md) — every auth-related env var and option.
- [Architecture](./architecture.md) — the two-plane picture in context.
