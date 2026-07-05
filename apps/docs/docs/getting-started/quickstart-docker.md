---
title: Quickstart with Docker
description: Run a self-hosted, S3-compatible OpenBucket container in about two minutes, then talk to it with the AWS CLI and the Node S3 SDK.
sidebar_position: 1
---

# Run OpenBucket with Docker in ~2 minutes

You'll boot a self-hosted, S3-compatible object store in a container, then put your first object into it with the AWS CLI. No cloud account, no signup — just Docker.

## Do it now

Run these three commands from the repository root:

```bash
# 1. Hash your admin password (argon2id). Copy the printed line.
node scripts/hash-password.mjs 'choose-a-strong-password'

# 2. Create your .env from the template, then paste the hash + fill the secrets.
cp .env.example .env

# 3. Build the image and start it.
docker compose up --build
```

When the logs settle, OpenBucket is listening on **http://localhost:9000**. Open the admin console at **http://localhost:9000/admin** and sign in with `admin` and the password you just hashed.

:::tip[What each command did]
`hash-password.mjs` prints an argon2id hash to stdout — the app stores only the hash, never your plaintext password. `docker compose up` builds the image from the repo `Dockerfile` and mounts a named volume (`openbucket-data`) at `/data`, so your buckets and objects survive a restart.
:::

## Fill in your .env

The app **validates every secret on boot and refuses to start** if one is missing or malformed. Open `.env` and set these five required values:

```bash
# Signs admin JWTs — 32+ chars. Generate with: openssl rand -hex 32
JWT_SECRET=change-me-to-a-random-string-at-least-32-chars

# The argon2id hash printed by step 1.
ADMIN_PASSWORD_HASH=$argon2id$v=19$m=65536,t=3,p=4$...

# S3 root credentials — point your SDK/CLI at these.
ROOT_ACCESS_KEY_ID=AKIAEXAMPLE000000000              # 16-32 uppercase alphanumerics
ROOT_SECRET_ACCESS_KEY=change-me-to-a-random-secret-at-least-32-chars
```

`DATA_DIR` is already handled — the Compose file pins it to `/data` (the mounted volume) and overrides anything you set. A few optional knobs you might touch:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `9000` | HTTP listen port. |
| `ADMIN_USERNAME` | `admin` | Admin console login. |
| `OPENBUCKET_REGION` | `us-east-1` | Region reported to S3 clients — match it in your SDK. |

The full, commented list lives in [`.env.example`](../reference/configuration.md).

## The URLs it exposes

Everything is **path-style** and served from the one port:

| Surface | URL |
| --- | --- |
| S3 API (path-style) | `http://localhost:9000` |
| Admin console | `http://localhost:9000/admin` |
| Admin JSON API | `http://localhost:9000/api/admin` |
| Health / readiness | `http://localhost:9000/api/admin/health`, `/api/admin/ready` |

:::note[Path-style only]
OpenBucket addresses buckets as `http://localhost:9000/my-bucket/key` — never `http://my-bucket.localhost:9000`. Virtual-host-style addressing is not supported, so always set path-style / `forcePathStyle: true` in your client.
:::

## Talk to it with the AWS CLI

Point the standard AWS CLI at your endpoint with `--endpoint-url`. Configure it once with the root credentials, region `us-east-1`, and path-style addressing:

```bash
aws configure set aws_access_key_id AKIAEXAMPLE000000000
aws configure set aws_secret_access_key change-me-to-a-random-secret-at-least-32-chars
aws configure set region us-east-1

aws --endpoint-url http://localhost:9000 s3 mb s3://my-bucket
aws --endpoint-url http://localhost:9000 s3 cp ./photo.jpg s3://my-bucket/photo.jpg
aws --endpoint-url http://localhost:9000 s3 ls s3://my-bucket
```

Refresh the admin console's object browser and you'll see `photo.jpg` land in `my-bucket`.

## Talk to it from Node

The AWS S3 SDK works unmodified — OpenBucket is wire-compatible. Point `endpoint` at the port and set `forcePathStyle: true`:

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  forcePathStyle: true, // required — virtual-host addressing is not supported
  credentials: {
    accessKeyId: 'AKIAEXAMPLE000000000',
    secretAccessKey: 'change-me-to-a-random-secret-at-least-32-chars',
  },
});

await s3.send(
  new PutObjectCommand({ Bucket: 'my-bucket', Key: 'hello.txt', Body: 'Hello, OpenBucket!' }),
);
```

Streaming PUT/GET, multipart uploads, presigned URLs, and range reads all behave exactly as they do against AWS S3.

:::warning[Keep your secrets out of version control]
`.env` holds real credentials — it should already be gitignored. Never commit it, and prefer a secrets manager over inline env vars for production.
:::

## Next steps

- [Core concepts](./core-concepts.md) — buckets, keys, and the two auth worlds you just used.
- [Embed in a NestJS app](./quickstart-embed.md) — skip the container and mount OpenBucket inside your own app.
- [Your first upload](./first-upload.md) — accept a browser upload and store it, end to end.
- [Configuration reference](../reference/configuration.md) — every environment variable, in detail.
