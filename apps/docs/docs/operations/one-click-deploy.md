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

## First: generate the admin password hash

OpenBucket stores an **argon2id hash** of the admin password, never the password
itself — so no platform can generate it for you. This is the one value you supply;
the templates generate `JWT_SECRET` and `ROOT_SECRET_ACCESS_KEY` automatically.

On any machine with Node (no repository checkout needed):

```bash
npx @openbucket/nestjs hash 'your-admin-password'
# → $argon2id$v=19$m=65536,t=3,p=4$...
```

Keep the printed `$argon2id$...` string handy — each platform below asks for it.

:::tip
`ROOT_ACCESS_KEY_ID` isn't secret (it's an identifier, like an AWS access key ID);
the templates default it to `AKIAOPENBUCKETROOT01`. The generated
`ROOT_SECRET_ACCESS_KEY` is the secret — copy it from the platform after deploy to
configure your S3 client (path-style, `forcePathStyle: true`).
:::

## CapRover

1. In the CapRover dashboard, go to **Apps → One-Click Apps/Databases**.
2. At the bottom, paste this raw URL (or the YAML directly):
   `https://raw.githubusercontent.com/ProjectBay/openbucket/main/deploy/caprover/openbucket.yml`
3. Fill in **Admin password hash** with your `$argon2id$...` value; the rest is
   pre-filled (JWT + S3 root secret are generated).
4. Deploy. The admin console is at `https://<app>.<your-domain>/admin`.

## Coolify

1. **New Resource → Docker Compose**, and paste
   [`deploy/coolify/docker-compose.yaml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/coolify/docker-compose.yaml).
2. In the service's **Environment Variables**, set `OPENBUCKET_ADMIN_PASSWORD_HASH`
   to your `$argon2id$...` value. Coolify generates `JWT_SECRET` and
   `ROOT_SECRET_ACCESS_KEY` (the `SERVICE_PASSWORD_64_*` magic variables).
3. Assign a **domain**; Coolify routes it to port 9000. Deploy.

## Render

1. Add [`render.yaml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/render/render.yaml)
   to your repo (or use it as a reference) and create a **Blueprint** in Render.
2. Render generates `JWT_SECRET` and `ROOT_SECRET_ACCESS_KEY`; set
   `ADMIN_PASSWORD_HASH` (marked `sync: false`) in the dashboard.
3. The 10 GB persistent disk mounts at `/data`.

## Fly.io

Using [`deploy/fly/fly.toml`](https://github.com/ProjectBay/openbucket/blob/main/deploy/fly/fly.toml):

```bash
fly launch --copy-config --no-deploy          # import the config
fly volumes create openbucket_data --size 10  # persistent storage at /data
fly secrets set \
  ADMIN_PASSWORD_HASH="$(npx @openbucket/nestjs hash 'your-admin-password')" \
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
