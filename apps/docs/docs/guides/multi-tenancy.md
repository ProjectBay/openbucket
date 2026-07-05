---
title: Multi-tenancy
description: Model tenants with buckets and scoped access keys, and separate operators with full vs read-only admin roles.
sidebar_position: 5
---

# Multi-tenancy

Give each tenant their own bucket (or prefix) and a **scoped access key** that
physically cannot reach anyone else's data — enforced on every S3 request by the
same policy evaluator your bucket policies use. Then split your operators into
**full admins** and **read-only admins**. Here's the whole thing.

## Mint a scoped key (the copy-paste version)

Ask the admin API for a key restricted to one bucket. The secret comes back
**exactly once** — capture it now.

```bash
curl -sS -X POST http://localhost:9000/api/admin/keys \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{
    "label": "acme-corp",
    "scope": { "kind": "prefix", "bucket": "acme-data" }
  }'
```

```json
{
  "id": "018f...c1",
  "accessKeyId": "AKIA...",
  "secretAccessKey": "shown-once-store-it-now",
  "label": "acme-corp",
  "role": "scoped",
  "createdAt": "2026-07-05T12:00:00.000Z",
  "scope": { "kind": "prefix", "bucket": "acme-data", "prefix": "" }
}
```

Hand that `accessKeyId` / `secretAccessKey` pair to the tenant. Point their S3
client at OpenBucket (path-style, region `us-east-1`) and they can read and write
`acme-data` — and nothing else.

## In the console

Open **Access keys**, click **Create key**, and flip on the **Restrict scope**
switch. The scope builder lets you pick a **bucket**, an optional **prefix**, and
a closed set of **actions** (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`,
`s3:ListBucket`). Leave the switch off to mint an unscoped, root-equivalent key.
The secret is revealed in a one-time dialog; there is no way to see it again — use
**Rotate** if it's lost.

## What "scoped" actually means

A `scope` on create mints a key with `role: "scoped"`. Omit `scope` and you get
`role: "root"` — an **unscoped, root-equivalent** key with no restriction. Root
credentials (the `ROOT_ACCESS_KEY_ID` from your environment) are loaded from
config and never persisted, so they can never carry a scope: scoping is strictly
**additive and opt-in**.

At mint time the scope is compiled into an IAM-style `PolicyDocument`. A bare
`prefix` scope on bucket `acme-data` with prefix `reports/` compiles to two
`Allow` statements:

- object actions on `arn:aws:s3:::acme-data/reports/*`
- `s3:ListBucket` on `arn:aws:s3:::acme-data`, gated by a `StringLike`
  `s3:prefix` condition so an unprefixed listing can't enumerate the whole bucket

The default action set for a bare prefix scope is
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`. Pass an
explicit `actions` array to narrow it — e.g. a read-only tenant key:

```json
{
  "label": "acme-readonly",
  "scope": {
    "kind": "prefix",
    "bucket": "acme-data",
    "prefix": "reports/",
    "actions": ["s3:GetObject", "s3:ListBucket"]
  }
}
```

Need something the prefix builder can't express? Pass `"kind": "policy"` with an
inline `PolicyDocument` (`Version` `2012-10-17` plus a `Statement` array). It's
size-capped and validated at the API boundary.

## How the policy evaluator enforces it

Every S3 request runs through `PolicyAuthorizationGuard` right after SigV4 auth.
It evaluates two things and ANDs them:

1. **The bucket policy** — root credentials evaluate with `defaultAllow: true`,
   so only an explicit `Deny` blocks them.
2. **The key scope** — a non-root scoped key is additionally evaluated against
   its compiled scope with `defaultAllow: false` (**implicit deny**). Anything the
   scope doesn't explicitly `Allow` is denied, even on a bucket with no policy.

The semantics are AWS-aligned: a matching `Deny` always wins, else a matching
`Allow` grants, else the default fallback applies. An operation the guard can't
map to an `s3:*` action **fails closed** for a scoped key.

:::info Root stays unrestricted
Root credentials are never scope-checked. Their request path is byte-identical to
a store with no scoping at all — a scoped key is a strictly narrower grant layered
on top.
:::

## What a denied request looks like

A scoped key reaching outside its bucket/prefix gets a standard S3 `403 Access
Denied`:

```bash
# acme-corp's key trying to read a different tenant's bucket
aws --endpoint-url http://localhost:9000 \
    s3 cp s3://globex-data/secret.txt . --profile acme
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied: out of key scope</Message>
</Error>
```

The same `AccessDenied` is returned for an out-of-scope action (e.g. a
delete-only-forbidden key trying to `PutObject`) and for a `ListObjects` whose
`?prefix=` falls outside the scoped prefix.

## Check a key before you ship it

Two read-only endpoints let you verify a scope without making a real request —
they use the **exact same evaluator** as the S3 path, so the console and
production never disagree:

```bash
# Full allow/deny matrix over the key's scoped resources
curl -sS http://localhost:9000/api/admin/keys/$KEY_ID/effective-permissions \
  -H "Authorization: Bearer $ADMIN_JWT"

# Simulate one action against one resource ARN
curl -sS -X POST http://localhost:9000/api/admin/keys/$KEY_ID/simulate \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{ "action": "s3:GetObject", "resource": "arn:aws:s3:::acme-data/reports/q3.csv" }'
```

The console surfaces the same matrix on each key's detail view.

## Rotate and revoke

- **Rotate** (`POST /api/admin/keys/{id}/rotate`) mints a fresh secret, keeps the
  `id` / `accessKeyId` / scope, and shows the new secret once. The old secret
  stops verifying immediately.
- **Revoke** (`POST /api/admin/keys/{id}/revoke`) disables the key reversibly and
  keeps the audit trail. **Delete** (`DELETE /api/admin/keys/{id}`) hard-removes
  it.

## Admin roles: full vs read-only

Tenant keys govern the S3 data plane. Your **operators** are governed separately
by admin-user roles. There are two:

- **`admin`** — a full operator; passes every admin route.
- **`readonly`** — can read every admin page but is `403`'d on every mutating
  (`POST` / `PUT` / `PATCH` / `DELETE`) admin route.

Create a read-only operator:

```bash
curl -sS -X POST http://localhost:9000/api/admin/users \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{ "username": "auditor", "password": "a-strong-passphrase", "role": "readonly" }'
```

The model is **default-deny by method**: a read-only admin is blocked on any
state-changing route automatically, so a newly added mutating route is read-only
safe without touching a decorator. The only exceptions are two self-service
actions a read-only admin can still perform: changing their own password
(`settings/change-password`) and logging out (`auth/logout`). Managing admin
users is itself full-admin-only.

:::warning The scope is fixed at mint time
A key's scope is compiled and stored when you create the key; there's no
"edit scope" endpoint. To change a tenant's reach, mint a new scoped key and
revoke the old one. `PATCH` only toggles `disabled` / `label`.
:::

:::note One bucket, or one prefix
A prefix scope pins a key to a single bucket (and optional key prefix). To give a
tenant several buckets, mint several keys, or author an inline `"kind": "policy"`
scope whose statements list each bucket's ARN.
:::

## Next steps

- [Securing OpenBucket](./securing-openbucket.md) — the full hardening checklist.
- [Backup and restore](./backup-and-restore.md) — per-bucket and whole-instance snapshots.
- [NestJS module reference](../reference/nestjs-module.md) — the `forRoot` option list.
