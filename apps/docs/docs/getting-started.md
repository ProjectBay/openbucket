---
sidebar_position: 2
title: Getting started
---

# Getting started

The fastest way to try OpenBucket is the standalone Docker image.

## Run with Docker

```bash
# 1. Generate an argon2id hash for your admin password
node scripts/hash-password.mjs 'choose-a-strong-password'

# 2. Copy the env template and fill in the secrets (incl. the hash above)
cp .env.example .env

# 3. Build the image and start it
docker compose up --build
```

OpenBucket is now listening on **http://localhost:9000**:

- **S3 API** — `http://localhost:9000` (path-style)
- **Admin console** — http://localhost:9000/admin
- **Admin API** — `http://localhost:9000/api/admin`
- **Health / readiness** — `/api/admin/health`, `/api/admin/ready`

## Talk to it with any S3 client

```bash
aws --endpoint-url http://localhost:9000 s3 mb s3://my-bucket
aws --endpoint-url http://localhost:9000 s3 cp ./photo.jpg s3://my-bucket/photo.jpg
```

Configure the AWS CLI/SDK with the `ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`
you set in `.env`, region `us-east-1`, and **path-style** addressing
(virtual-host addressing is not supported).

## Configuration

The standalone app reads its config from the environment and **refuses to boot**
if anything is invalid. See `.env.example` in the repo for the full, commented
list. The essentials:

| Variable                 | Required | Default     | Notes                                                       |
| ------------------------ | -------- | ----------- | ----------------------------------------------------------- |
| `DATA_DIR`               | ✅       | —           | Directory for the SQLite DB + blob payloads + `sse.key`.    |
| `JWT_SECRET`             | ✅       | —           | ≥ 32 chars; signs admin JWTs.                               |
| `ADMIN_PASSWORD_HASH`    | ✅       | —           | argon2id hash (`node scripts/hash-password.mjs <pw>`).      |
| `ROOT_ACCESS_KEY_ID`     | ✅       | —           | 16–32 uppercase alphanumerics.                              |
| `ROOT_SECRET_ACCESS_KEY` | ✅       | —           | ≥ 32 chars.                                                 |
| `PORT`                   |          | `9000`      | HTTP listen port.                                           |
| `ADMIN_USERNAME`         |          | `admin`     | Admin login.                                                |
| `OPENBUCKET_REGION`      |          | `us-east-1` | Region reported to clients.                                 |
| `OPENBUCKET_SSE_KEY`     |          | generated   | base64 of 32 bytes; auto-generated to `<DATA_DIR>/sse.key`. |

## Run from source

OpenBucket runs on a single Node.js version — **Node 22** (pinned in `.nvmrc`).

```bash
npm ci
nx serve openbucket-backend      # backend (S3 + admin API)
nx serve openbucket-frontend     # Angular admin console
```

See [Contributing](./contributing.md) for the full contributor workflow.
