---
title: Securing OpenBucket
description: A practical hardening checklist — strong secrets, argon2id admin hash, bucket policies, scoped keys, read-only admins, TLS, security headers, rate limits, and integrity scrubbing.
sidebar_position: 8
---

# Securing OpenBucket

A concrete, top-to-bottom checklist for a production deployment. OpenBucket ships
secure-by-default in most places (it refuses to boot on weak secrets, ships a
restrictive CSP, and denies by default), so much of this is verifying you didn't
opt out. Work top to bottom.

## The 60-second checklist

1. **Strong secrets** — every security-critical secret passes the entropy floor.
2. **argon2id admin hash** — never a plaintext admin password.
3. **Bucket policies** — an explicit `Deny` blocks even root.
4. **Scoped keys** — tenants get bucket/prefix-restricted keys, not root.
5. **Read-only admins** — auditors and dashboards run as `readonly`.
6. **TLS via a reverse proxy** — terminate HTTPS in front, trust only loopback.
7. **Security headers** — keep the built-in CSP; don't weaken it.
8. **Rate limits** — leave the S3 + admin throttlers on.
9. **Integrity scrubbing** — enable the background scrubber to catch bit-rot.

## 1. Strong secrets

Security-critical secrets go through an entropy floor at boot: at least **32
characters**, not a single repeated character, not a known placeholder, and at
least **8 distinct characters**. Fail any check and the process **refuses to
boot** — you can't accidentally ship a placeholder. This covers `JWT_SECRET`,
`ROOT_SECRET_ACCESS_KEY`, the optional `KEY_ENCRYPTION_SECRET` (encrypts scoped
sub-key secrets at rest), a `token`-mode `METRICS_TOKEN`, and `WEBHOOK_SECRET`.

Generate real ones:

```bash
openssl rand -base64 48
```

:::tip[Set KEY_ENCRYPTION_SECRET before you mint scoped keys]
Scoped sub-key secrets are encrypted at rest with the instance KEK derived from
`KEY_ENCRYPTION_SECRET`. Set it early — rotating it later invalidates existing
encrypted sub-key secrets.
:::

## 2. argon2id admin hash

The admin password is stored only as an **argon2id** hash — never plaintext.
Generate the hash and pass it as `ADMIN_PASSWORD_HASH`. The `hash` command ships
in the package, so it works with no repo checkout:

```bash
npx @openbucket/nestjs hash 'choose-a-strong-password'
# …or, from a repo clone:
node scripts/hash-password.mjs 'choose-a-strong-password'
```

The first-run bootstrap admin is seeded with a "must change password" flag, so the
initial credential can't be used long-term.

## 3. Bucket policies (Deny is enforced)

OpenBucket evaluates the IAM-style bucket-policy subset it accepts on every S3
request, with **explicit-deny-overrides** semantics: a matching `Deny` always
wins, even against root credentials (root evaluates with a default-allow, so only
an explicit `Deny` can block it). Use a `Deny` as a compensating control — for
example, refuse any request that didn't arrive over TLS:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::acme-data", "arn:aws:s3:::acme-data/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
```

Supported conditions: `Bool aws:SecureTransport`, `IpAddress` / `NotIpAddress`
`aws:SourceIp`, and `StringLike` / `StringNotLike` `s3:prefix`. Unknown
operators **fail closed** — they never silently widen an `Allow`.

## 4. Scoped access keys

Never hand a tenant root credentials. Mint a **scoped key** restricted to their
bucket/prefix; the policy evaluator enforces it with implicit-deny so it
physically can't reach another tenant's data. See
[Multi-tenancy](./multi-tenancy.md) for the full walkthrough.

## 5. Read-only admins

Give auditors, dashboards, and anyone who only needs to look a `readonly` admin
role. The role guard is **default-deny by method**: a read-only admin is `403`'d
on every state-changing admin route automatically. See
[admin roles](./multi-tenancy.md#admin-roles-full-vs-read-only).

## 6. TLS and reverse proxy

OpenBucket speaks plain HTTP and is designed to sit behind a TLS-terminating
reverse proxy. It sets `trust proxy` to **`loopback` only**, so `req.secure` (and
the `aws:SecureTransport` condition) is honest — a client can't spoof HTTPS by
sending an `X-Forwarded-Proto` header from off-box. Terminate TLS in nginx /
Caddy / your load balancer on the same host (or a trusted network path) and
forward to OpenBucket over loopback.

:::warning[Don't widen the proxy trust blindly]
The `loopback`-only trust is deliberate. If you front OpenBucket from a proxy on a
different host, make sure the network path is trusted before relying on
`aws:SecureTransport` — a spoofable forwarded-proto header would let a plaintext
request masquerade as TLS.
:::

## 7. Security headers and CSP

The standalone app applies a restrictive Content-Security-Policy via Helmet for
the admin SPA and API — `default-src 'self'`, `object-src 'none'`, `script-src
'self'`, `frame-ancestors 'self'`, images limited to `self` / `data:` / `blob:`.
Raw S3 object responses are served under an even stricter per-response
`default-src 'none'; sandbox` so a stored HTML/SVG object can't execute in a
victim's session. `x-powered-by` is disabled. Keep these — don't relax the CSP to
make a third-party script load.

## 8. Rate limits

Two throttlers ship on by default and should stay on:

- **S3 surface** — `S3_THROTTLE_LIMIT` requests per `S3_THROTTLE_TTL_MS` window
  (default **1000 / 60s**).
- **Admin surface** — 100 requests/min, with a tighter **10/min** on the
  CPU-heavy key-rotate route (argon2id hashing makes a rotate flood a compute-DoS
  vector).

Restore and upload paths carry their own size/entry caps on top of these.

## 9. Integrity scrubbing

A background scrubber can re-hash local blobs against their stored SHA-256 to
catch bit-rot or tampering at rest. It's **off by default** and strictly rate
limited so it never starves request traffic:

```bash
OB_INTEGRITY_SCRUB_ENABLED=true
OB_INTEGRITY_SCRUB_INTERVAL_MS=60000          # tick cadence
OB_INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK=1000  # per-tick object budget
OB_INTEGRITY_SCRUB_MAX_BYTES_PER_TICK=...     # per-tick byte budget
```

Each object gets a verdict (`unchecked` / `ok` / `corrupt`). When a
[replication target](./replication-and-tiering.md) is configured, the scrubber
can **repair a corrupt local blob from the good remote copy** — staged through the
two-phase writer and digest-verified before the swap. The console's **Integrity**
page (and `GET /api/admin/integrity`) surface the scan summary, the corrupt-object
list, and a manual "scrub now" trigger, with a corrupt-count badge in the sidebar.

## Where this posture comes from

This checklist reflects OpenBucket's durability-and-hardening work (the EPIC-08
posture): refuse-to-boot env validation, explicit-deny bucket policies, at-rest
encryption of secrets, a restrictive CSP, and fail-closed authorization. For the
findings and remediations behind it, see the
[2026 security audit](../concepts/security-audit-2026.md). It is a
solid baseline for a self-hosted store — not a substitute for your own threat
model, network segmentation, and OS-level hardening of the data volume.

:::note[Lock down the observability surface too]
Leave `METRICS_MODE=off` unless you need a Prometheus scrape; when you do, prefer
`token` mode with a strong `METRICS_TOKEN` over `public`. The `/metrics` endpoint
never emits raw URLs, keys, or IPs, but the token keeps casual scrapers out.
:::

## Next steps

- [Multi-tenancy](./multi-tenancy.md) — scoped keys and admin roles in depth.
- [Backup and restore](./backup-and-restore.md) — snapshots are plaintext; protect them.
- [Replication and tiering](./replication-and-tiering.md) — off-box durability and the scrubber's repair source.
