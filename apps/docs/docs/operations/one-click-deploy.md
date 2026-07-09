---
title: One-click deploy
description: Deploy the standalone OpenBucket image to CapRover, Coolify, Render, or Fly.io with a ready-made template — persistent volume, generated secrets, S3 API + admin console.
sidebar_position: 2
---

# One-click deploy

Ready-made templates for deploying the standalone
[`ghcr.io/projectbay/openbucket`](https://github.com/ProjectBay/openbucket/pkgs/container/openbucket)
image to popular self-hosting platforms. Each one provisions a persistent volume
at `/data`, exposes the S3 API and admin console on port **9000**, and generates
the random secrets for you.

The templates live in [`deploy/`](https://github.com/ProjectBay/openbucket/tree/main/deploy)
in the repo.

## Credentials — just set an admin password

Every template generates the `JWT_SECRET` and `ROOT_SECRET_ACCESS_KEY` for you. For
the admin login, set **`ADMIN_PASSWORD`** to a value of your choice (or let the
platform generate one) — OpenBucket argon2id-hashes it on first boot and never
stores the plaintext. No hash to generate, nothing to paste.

:::tip Prefer to pre-hash it?
Set **`ADMIN_PASSWORD_HASH`** instead (e.g. from `npx @openbucket/nestjs hash 'pw'`)
— it takes precedence over `ADMIN_PASSWORD`. Handy if you don't want the plaintext
in the platform's environment at all.
:::

:::note
`ROOT_ACCESS_KEY_ID` isn't secret (it's an identifier, like an AWS access key ID);
the templates default it to `AKIAOPENBUCKETROOT01`. The generated
`ROOT_SECRET_ACCESS_KEY` is the secret — copy it from the platform after deploy to
configure your S3 client (path-style, `forcePathStyle: true`).
:::

## CapRover

1. In the CapRover dashboard, go to **Apps → One-Click Apps/Databases**.
2. At the bottom, paste this raw URL (or the YAML directly):
   `https://raw.githubusercontent.com/ProjectBay/openbucket/main/deploy/caprover/openbucket.yml`
3. Choose an **Admin password** (min 8 chars); the rest is pre-filled (JWT + S3
   root secret are generated).
4. Deploy. The admin console is at `https://<app>.<your-domain>/admin`.

## Coolify

1. **New Resource → Docker Compose**, and paste
   [`deploy/coolify/docker-compose.yaml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/coolify/docker-compose.yaml).
2. Coolify generates the admin password, `JWT_SECRET`, and `ROOT_SECRET_ACCESS_KEY`
   (the `SERVICE_PASSWORD_*` magic variables). Copy the generated
   `SERVICE_PASSWORD_ADMIN` from the service's **Environment Variables** to log in —
   or set `OPENBUCKET_ADMIN_PASSWORD` there to pick your own.
3. Assign a **domain**; Coolify routes it to port 9000. Deploy.

## Render

1. Add [`render.yaml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/render/render.yaml)
   to your repo (or use it as a reference) and create a **Blueprint** in Render.
2. Render generates the admin password, `JWT_SECRET`, and `ROOT_SECRET_ACCESS_KEY`.
   Copy `ADMIN_PASSWORD` from the dashboard to log in (or replace it with your own).
3. The 10 GB persistent disk mounts at `/data`.

## Fly.io

Using [`deploy/fly/fly.toml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/fly/fly.toml):

```bash
fly launch --copy-config --no-deploy          # import the config
fly volumes create openbucket_data --size 10  # persistent storage at /data
fly secrets set \
  ADMIN_PASSWORD='choose-a-strong-admin-password' \
  JWT_SECRET="$(openssl rand -hex 32)" \
  ROOT_SECRET_ACCESS_KEY="$(openssl rand -hex 32)"
fly deploy
```

## After deploying

- **Put it behind HTTPS.** All platforms above terminate TLS for you; OpenBucket
  itself speaks plain HTTP on 9000.
- **Back up.** Turn on [scheduled backups](../guides/backup-and-restore.md) and,
  for real durability, [replicate](../guides/replication-and-tiering.md) to an
  external S3 target — OpenBucket is single-node (see
  [Is OpenBucket for you?](../is-openbucket-for-you.md)).
- **Connect a client:** point any S3 SDK at your deploy URL with path-style
  addressing and the root credentials. See the
  [Docker quickstart](../getting-started/quickstart-docker.md).
