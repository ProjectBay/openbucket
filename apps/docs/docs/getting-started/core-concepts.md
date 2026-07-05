---
title: Core concepts
description: The mental model behind OpenBucket — buckets, objects, keys and prefixes, standalone vs embedded, the mountPath, and the two separate auth worlds.
sidebar_position: 4
---

# Core concepts

A five-minute mental model of OpenBucket: what stores your bytes, the two ways to run it, and the two entirely separate systems that guard access. Skim it once and the rest of the docs click into place.

## Buckets, objects, keys, and prefixes

OpenBucket is an **object store** with the same shape as Amazon S3:

- A **bucket** is a flat, named container for objects. Bucket names follow S3 rules (3–63 characters, DNS-style).
- An **object** is a blob of bytes plus metadata (content type, ETag, size, tags, an optional version). OpenBucket stores the metadata in SQLite and the payload on the local filesystem.
- A **key** is the object's full name within a bucket — e.g. `2026/photos/cat.jpg`. Keys are byte strings, not a real directory tree.
- A **prefix** is just the leading part of a key. There are no folders on disk, but a listing with a `delimiter` of `/` rolls keys up into `commonPrefixes`, giving you folder-style browsing over a flat namespace.

```ts
// Folder-style listing: everything directly "under" 2026/photos/
const { contents, commonPrefixes } = await ob.listObjects('my-bucket', {
  prefix: '2026/photos/',
  delimiter: '/',
});
```

:::note[Keys are stable identity]
An object is identified by `{ bucket, key }`. That pair is what you persist in your own database — never a presigned URL, which expires. Mint a fresh URL from the key whenever you need one (see [Your first upload](./first-upload.md)).
:::

## Standalone vs embedded

The same codebase ships in two shapes, and they behave identically on the wire:

- **Standalone** — a small Docker image / Node process. It reads its config from environment variables, refuses to boot if anything is invalid, and serves the S3 API at the **root** of its port (default `9000`). Point any S3 SDK at it. See [Quickstart with Docker](./quickstart-docker.md).
- **Embedded** — the [`@openbucket/nestjs`](../reference/nestjs-module.md) library. You call `OpenBucketModule.forRoot({ ... })` inside your own NestJS app and configure it in code, and everything mounts under a path prefix so it never collides with your routes. See [Embed in a NestJS app](./quickstart-embed.md).

Pick standalone for a drop-in S3 service; pick embedded when you want an object store *inside* an app and the ability to drive it in-process via `OpenBucketService`.

## The `mountPath`

`mountPath` is the route prefix under which **all** OpenBucket routes live — the S3 wire protocol, the admin JSON API, and the admin console.

- **Embedded**, it defaults to `/storage`. Your S3 endpoint becomes `http://<host><mountPath>` (e.g. `http://localhost:3000/storage`), the admin API is at `<mountPath>/api/admin`, and the console at `<mountPath>/admin`.
- **Standalone**, there's no prefix — the store owns the whole port, so the endpoint is just `http://localhost:9000` and the console is at `/admin`.

Because everything sits under `mountPath`, OpenBucket's greedy S3 routes (`:bucket/:key`) never shadow a host app's own routes, and its exception filter only renders errors for requests under the prefix.

:::warning[Path-style addressing only]
OpenBucket addresses buckets as `<endpoint>/<bucket>/<key>`, never `<bucket>.<host>`. Virtual-host-style addressing is not supported, so always configure your client for path-style (`forcePathStyle: true` in the AWS SDK).
:::

## Two auth worlds

This is the concept people trip on most: OpenBucket has **two completely separate** authentication systems. They never overlap.

### 1. S3 access keys (the data plane)

These sign S3 requests with **AWS Signature V4** — the credentials your SDK, CLI, or presigned URLs use to read and write objects.

- The **root credential** (`ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`, or `rootCredentials` in code) is loaded from config, never persisted, and is **always unrestricted**.
- **Scoped sub-keys** are full SigV4 keys you mint whose reach is confined to a bucket + key-prefix (or an inline policy). Scoping is enforced through the same policy evaluator as bucket policies, with implicit deny — so a tenant key can't read outside its prefix, list the whole bucket, or enumerate all buckets. Mint them via `POST /api/admin/keys` with a `scope`:

  ```jsonc
  // Confine a key to read+write under one bucket/prefix.
  { "kind": "prefix", "bucket": "tenants", "prefix": "tenant-a/",
    "actions": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"] }
  ```

  A sub-key minted with a scope records `role: 'scoped'`; without one, `role: 'root'` (unscoped, root-equivalent). Keys can be rotated, revoked, and inspected via an effective-permissions matrix.

### 2. Admin console users (the control plane)

These sign in to the **admin console and JSON API** — a different credential entirely, backed by an argon2id password and a rotating JWT, not SigV4.

- Each admin user has a **role**: `admin` (**full admin** — every action) or `readonly` (can sign in and view everything, but is `403`'d on any change).
- The first-run bootstrap admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`) is a full admin. Manage additional admins from the console or `POST /api/admin/users`.
- Enforcement is server-side and default-deny by HTTP method, read fresh from the DB on every request, so a demotion takes effect immediately.

:::info[Two roles, same word, different worlds]
A minted **S3 access key** carries `role: 'scoped'` or `role: 'root'` — that labels a *data-plane* key's reach. An **admin user** carries `role: 'admin'` or `role: 'readonly'` — that governs the *admin console*. They are orthogonal: an S3 key can't sign into the console, and an admin login can't sign an S3 request.
:::

## What the admin surface is

When the admin block is enabled, OpenBucket wires up an **admin surface** — everything you don't get on the raw S3 wire:

- A **JSON admin API** at `<mountPath>/api/admin/*`, secured by argon2id passwords + rotating JWTs.
- The bundled **Angular admin console** (when `serveUi: true`) at `<mountPath>/admin`: a bucket & object browser, cross-bucket object search, upload/download, inline object preview, presigned share links, access-key management, multi-admin users, per-bucket versioning / encryption / object-lock / lifecycle / CORS / policy editors, a usage-analytics dashboard, and a persisted audit log.

Omit the admin block and you get a **headless, S3-only store**: no admin API, no JWT guard, no console — just the S3 wire protocol plus health probes. See [Run headless](./quickstart-embed.md#run-headless-s3-only-no-admin).

## Next steps

- [Quickstart with Docker](./quickstart-docker.md) — run the standalone store and use the two credential systems.
- [Embed in a NestJS app](./quickstart-embed.md) — mount it in your app, with or without the admin surface.
- [Your first upload](./first-upload.md) — put the key/prefix and presigning ideas to work.
- [NestJS module reference](../reference/nestjs-module.md) — the full API surface.
