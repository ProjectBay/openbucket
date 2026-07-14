---
slug: one-click-deploys
title: 'Your own S3, deployed in minutes: one-click templates for Render, Fly, Coolify & CapRover'
description: Deploy a self-hosted, S3-compatible object store in minutes with one-click templates for Render, Fly.io, Coolify, and CapRover — just pick an admin password.
authors: [openbucket]
tags: [deployment, self-hosted, s3, render, fly, coolify]
date: 2026-09-02
keywords:
  [
    deploy s3 compatible storage,
    self-hosted s3 render.com,
    coolify object storage,
    fly.io s3 storage,
    caprover one click apps,
    self-hosted object storage,
    minio alternative,
  ]
draft: true
---

There's a gap between "this project looks interesting" and "I have a running
instance with a URL I can point an SDK at" — and for most self-hosted software,
that gap is an evening of YAML. We wanted OpenBucket's gap to be a coffee break.

So the repo now ships **one-click / one-file deploy templates** for four popular
platforms — [Render](https://render.com), [Fly.io](https://fly.io),
[Coolify](https://coolify.io), and [CapRover](https://caprover.com) — under
[`deploy/`](https://github.com/ProjectBay/openbucket/tree/main/deploy). Each one
runs the standalone `ghcr.io/projectbay/openbucket` image, provisions a
persistent volume at `/data`, and generates the random secrets for you. The only
decision left is your admin password.

<!-- truncate -->

## Why "one-click" used to be impossible

OpenBucket refuses to boot with weak or missing secrets — that's a feature. But
until v0.1.0-alpha.19, one of those required values was `ADMIN_PASSWORD_HASH`:
a pre-computed **argon2id hash** of your admin password. You had to run
`npx @openbucket/nestjs hash 'your-password'` locally and paste the result into
the platform's env config. That's fine for a `.env` file; it's fatal for a
one-click flow, where the platform fills in values for you and there's no
terminal in sight.

Alpha.19 fixed this with a plaintext **`ADMIN_PASSWORD`** variable. The
semantics are deliberately narrow:

- OpenBucket **argon2id-hashes it on first boot** and seeds the admin user once
  — the plaintext is never stored and never logged.
- `ADMIN_PASSWORD_HASH` **still takes precedence** if you set it — handy when
  you'd rather not have the plaintext in the platform's environment at all.

That one change made every template below possible: platforms that can generate
random values can now provision a complete, working instance.

## What every template sets up

All four templates share the same shape:

- The pinned image `ghcr.io/projectbay/openbucket:0.1.0-alpha.20` (we're
  pre-1.0, so there's no `latest` tag to lean on — pinning is the point).
- A **persistent volume mounted at `/data`** (`DATA_DIR=/data`). This is where
  the SQLite metadata *and* every blob live. No volume, no data after a
  redeploy — this is the one thing you should double-check on any platform.
- Port **9000**, serving the S3 API, the admin API, and the admin console from
  one process. The platform terminates TLS in front of it.
- Auto-generated `JWT_SECRET` and `ROOT_SECRET_ACCESS_KEY`. The
  `ROOT_ACCESS_KEY_ID` defaults to `AKIAOPENBUCKETROOT01` — like an AWS access
  key ID, it's an identifier, not a secret, so a shared default is fine
  (override it if you like).

When it's up, `https://<your-app-url>/admin` is the admin console and the root
URL is your S3 endpoint (path-style addressing).

## Render

Add [`deploy/render/render.yaml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/render/render.yaml)
to a repo as `render.yaml` and create a **Blueprint**. Render generates the
admin password, `JWT_SECRET`, and `ROOT_SECRET_ACCESS_KEY` (`generateValue: true`),
and provisions a **10 GB persistent disk** at `/data`. You provide: nothing,
strictly — but copy the generated `ADMIN_PASSWORD` from the dashboard to log in
(or replace it with your own), and it's worth verifying the generated
`JWT_SECRET` came out at 32+ characters, since OpenBucket will refuse to boot
otherwise.

## Fly.io

Fly is the one template that isn't a web form — it's four commands with
[`deploy/fly/fly.toml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/fly/fly.toml):

```bash
fly launch --copy-config --no-deploy          # import the config
fly volumes create openbucket_data --size 10  # persistent storage at /data
fly secrets set \
  ADMIN_PASSWORD='choose-a-strong-admin-password' \
  JWT_SECRET="$(openssl rand -hex 32)" \
  ROOT_SECRET_ACCESS_KEY="$(openssl rand -hex 32)"
fly deploy
```

Note the explicit `fly volumes create` — on Fly, the volume is your job, and
the config mounts it at `/data`. The template also sets
`auto_stop_machines = false` and `min_machines_running = 1`, because an object
store that scales to zero mid-upload is not a good time.

## Coolify

**New Resource → Docker Compose**, paste
[`deploy/coolify/docker-compose.yaml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/coolify/docker-compose.yaml),
assign a domain (Coolify routes it to port 9000), deploy. Coolify's magic
`SERVICE_PASSWORD_*` variables generate all three secrets — including the admin
password, which lands in the service's **Environment Variables** as
`SERVICE_PASSWORD_ADMIN`. Copy it to log in, or edit the admin password value
there to pick your own. Data persists in the named `openbucket-data` volume,
and the compose file wires a healthcheck against `/api/admin/health` so Coolify
knows when the instance is actually ready.

## CapRover — the full follow-along

CapRover's template is the most complete of the four — a proper one-click app
with a form, generated defaults, and post-deploy instructions — so let's walk
it end to end.

1. In the CapRover dashboard, go to **Apps → One-Click Apps/Databases** and
   paste this raw URL at the bottom (or paste the YAML itself):

   ```
   https://raw.githubusercontent.com/ProjectBay/openbucket/main/deploy/caprover/openbucket.yml
   ```

2. Fill in the form. Only one field actually needs you:

   - **Admin password** — your choice, minimum 8 characters. This is the
     plaintext `ADMIN_PASSWORD` from earlier: hashed on first boot, never
     stored.
   - Everything else is pre-filled: image tag (`0.1.0-alpha.20`), admin
     username (`admin`), region (`us-east-1`), access key ID
     (`AKIAOPENBUCKETROOT01`), and randomly generated values for `JWT_SECRET`
     and `ROOT_SECRET_ACCESS_KEY`.

3. Deploy. CapRover creates a per-app volume mounted at `/data`, so your
   objects survive restarts and app updates.

4. You land on two URLs:

   - **Admin console** — `https://<app>.<your-root-domain>/admin`. Sign in with
     `admin` and the password you chose; you'll see the dashboard, bucket
     browser, and settings.
   - **S3 endpoint** — `https://<app>.<your-root-domain>` (path-style).

5. Last step: open the app's **App Configs** tab and copy
   `ROOT_SECRET_ACCESS_KEY` — that's the credential your S3 clients will use.

## Day 2: point an SDK at it

Your new instance speaks the S3 wire protocol, so the client side is the
standard AWS SDK — just three settings that matter: your endpoint, path-style
addressing, and the root credentials.

```ts
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'https://openbucket.your-domain.example',
  region: 'us-east-1',
  forcePathStyle: true, // required — virtual-host addressing is not supported
  credentials: {
    accessKeyId: 'AKIAOPENBUCKETROOT01',
    secretAccessKey: '<the generated ROOT_SECRET_ACCESS_KEY>',
  },
});
```

Two things worth doing before you put anything important in it:

- **Harden it.** Don't hand the root credential to every app — mint scoped
  access keys, review the exposed surface, and check the checklist in
  [Securing OpenBucket](/docs/guides/securing-openbucket).
- **Back it up.** OpenBucket is single-node by design; that `/data` volume is
  the whole instance. Turn on scheduled snapshots (and, ideally, replication to
  an external S3 target) — see
  [Backup & restore](/docs/guides/backup-and-restore).

The step-by-step platform docs live at
[One-click deploy](/docs/operations/one-click-deploy), and if you're still
deciding whether a single-node store fits your workload,
[Is OpenBucket for you?](/docs/is-openbucket-for-you) gives you the honest
answer.

---

Deployed one? We'd love to hear which platform and how it went — tell us in
[Discussions](https://github.com/ProjectBay/openbucket/discussions). And if the
template saved you an evening of YAML, a star on
[GitHub](https://github.com/ProjectBay/openbucket) is how the next person finds
it.
