---
slug: point-your-s3-sdk-at-localhost
title: 'Keep your S3 SDK, swap the endpoint: local-dev object storage without AWS'
description: Point @aws-sdk/client-s3 at a local Docker container instead of AWS — change the endpoint, set forcePathStyle, and your existing S3 code keeps working.
authors: [openbucket]
tags: [s3, local-development, docker, aws-sdk, self-hosted]
date: 2026-08-12
keywords:
  [
    s3 compatible local development,
    aws sdk local s3 endpoint,
    minio alternative local dev,
    s3 emulator docker,
    forcePathStyle localhost,
    local s3 docker compose,
    self-hosted s3 for developers,
  ]
draft: true
---

Your app already talks S3. The `@aws-sdk/client-s3` calls are written, tested,
and shipping to production. The annoying part is everything *around* local
development: shared dev buckets that teammates trample, IAM credentials on
laptops, tests that hit the network, and a cloud bill for uploading `test.png`
four hundred times.

Here's the whole pitch of this post: you don't have to change your S3 code to
fix that. OpenBucket speaks the S3 wire protocol — SigV4 auth, presigned URLs,
multipart uploads, versioning, XML errors — so your existing SDK code keeps
working. You change the **endpoint**, the **credentials**, and set
**path-style addressing**. That's the entire migration.

<!-- truncate -->

## Step 1 — Run the store (one container)

OpenBucket ships as a single multi-arch image on GHCR:
`ghcr.io/projectbay/openbucket`. It refuses to boot with weak or missing
secrets, so you pass a handful of env vars. For pure local dev, `ADMIN_PASSWORD`
is the shortcut — OpenBucket argon2id-hashes it on first boot and never stores
the plaintext (for hardened setups you'd pass a pre-computed
`ADMIN_PASSWORD_HASH` instead):

```bash
docker run --rm -p 9000:9000 -v openbucket-data:/data \
  -e DATA_DIR=/data \
  -e ADMIN_PASSWORD='local-dev-password' \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ROOT_ACCESS_KEY_ID='AKIALOCALDEV0000000' \
  -e ROOT_SECRET_ACCESS_KEY='local-dev-secret-key-at-least-32-chars!!' \
  ghcr.io/projectbay/openbucket:0.1.0-alpha.20
```

The constraints, if you pick your own values: `ROOT_ACCESS_KEY_ID` is 16–32
uppercase alphanumerics, and `JWT_SECRET` / `ROOT_SECRET_ACCESS_KEY` are 32+
characters.

Prefer compose? The repo ships a ready-made
[`examples/docker-standalone`](https://github.com/ProjectBay/openbucket/tree/main/examples/docker-standalone)
with a named volume and a healthcheck — the core of it:

```yaml title="docker-compose.yml"
services:
  openbucket:
    image: ghcr.io/projectbay/openbucket:0.1.0-alpha.20
    restart: unless-stopped
    ports:
      - '9000:9000'
    env_file:
      - .env
    environment:
      DATA_DIR: /data
    volumes:
      - openbucket-data:/data

volumes:
  openbucket-data:
```

Either way, everything now lives on **http://localhost:9000**: the S3 API at
the root (path-style), the admin console at `/admin`, and health probes at
`/api/admin/health`. Full setup details are in the
[Docker quickstart](/docs/getting-started/quickstart-docker).

## Step 2 — The config diff

This is the entire code change. If your `S3Client` config already comes from
env vars, it's a **zero-code** change:

```diff
 import { S3Client } from '@aws-sdk/client-s3';

 const s3 = new S3Client({
-  region: 'eu-central-1',
+  endpoint: 'http://localhost:9000',
+  region: 'us-east-1',
+  forcePathStyle: true,
+  credentials: {
+    accessKeyId: 'AKIALOCALDEV0000000',
+    secretAccessKey: 'local-dev-secret-key-at-least-32-chars!!',
+  },
 });
```

Three things worth knowing:

- **`forcePathStyle: true` is required.** OpenBucket addresses buckets as
  `http://localhost:9000/my-bucket/key`, never as a
  `my-bucket.localhost` subdomain. Virtual-host addressing is not supported —
  which is fine, because subdomains and localhost never got along anyway.
- **`region: 'us-east-1'`** matches the default `OPENBUCKET_REGION` the store
  reports. If you override one, override both — SigV4 signatures embed the
  region.
- **The credentials are the root key pair** you set via env vars — no IAM, no
  session tokens, nothing to provision.

This isn't a docs-only claim: it is byte-for-byte how OpenBucket's own
conformance suite configures `@aws-sdk/client-s3` against a freshly booted
container before round-tripping objects through it.

## Step 3 — A put / get / presign roundtrip

Your existing commands work unchanged. A quick smoke test:

```ts
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

await s3.send(new CreateBucketCommand({ Bucket: 'uploads' }));

await s3.send(
  new PutObjectCommand({
    Bucket: 'uploads',
    Key: 'hello.txt',
    Body: 'Hello from localhost',
    ContentType: 'text/plain',
  }),
);

const got = await s3.send(new GetObjectCommand({ Bucket: 'uploads', Key: 'hello.txt' }));
console.log(await got.Body!.transformToString()); // "Hello from localhost"

// Presigned URLs work too — SigV4 query auth, verified server-side:
const url = await getSignedUrl(
  s3,
  new GetObjectCommand({ Bucket: 'uploads', Key: 'hello.txt' }),
  { expiresIn: 900 },
);
```

Paste that URL into a browser or `curl` it — the store verifies the signature
and expiry exactly like AWS does. Streaming PUT/GET, multipart uploads, range
reads, tagging, and bucket versioning (including `?versionId` reads) behave the
same way; the [S3 compatibility reference](/docs/reference/s3-compatibility)
lists the full surface.

## Not just the JavaScript SDK

Anything that speaks S3 with path-style addressing works. OpenBucket's
conformance matrix runs these clients in CI alongside the JS SDK:

```bash
# AWS CLI
aws --endpoint-url http://localhost:9000 s3 mb s3://my-bucket
aws --endpoint-url http://localhost:9000 s3 cp ./photo.jpg s3://my-bucket/photo.jpg

# MinIO client (mc)
mc alias set local http://localhost:9000 "$ACCESS_KEY" "$SECRET_KEY" --api S3v4
mc cp ./photo.jpg local/my-bucket/

# s3cmd works too — it's the third row of the same conformance matrix
```

If your stack is Python, Go, or Rust, the recipe is identical: endpoint,
region, credentials, path-style. The wire protocol is the contract.

## The part where it stops being an emulator

Here's the difference from a throwaway mock: OpenBucket isn't a fake S3 that
you discard on deploy. It's a real, persistent object store — SQLite for
metadata, the local filesystem for blobs — that you can also run as your
production storage on a single node, or embed straight into a NestJS app as an
npm package. Same engine, same data, laptop to server.

And because it's a full store rather than a stub, local dev picks up things a
mock never gives you:

- **An admin console at `/admin`** — sign in with `admin` and your password to
  browse buckets, preview objects inline, mint share links, and manage access
  keys. No more `aws s3 ls` archaeology to find out what your test suite wrote.
- **Real S3 semantics** — versioning, lifecycle rules, CORS, bucket policies,
  and object lock are all there to develop against, not discover in staging.
- **Presigned uploads and downloads** that behave like production, so your
  browser-upload flow is testable offline.

## The honest caveats

OpenBucket is **pre-1.0** and under active development — the S3 surface and
admin console are feature-complete and tested, but APIs may still move before
1.0. It's also **single-node by design**: one process, SQLite, local disk.
That's exactly right for local dev, CI, and self-hosted apps of moderate scale;
it is not a distributed storage cluster, and we won't pretend otherwise. For
multi-node or petabyte territory, the
[OpenBucket vs MinIO](/docs/comparisons/vs-minio) comparison and
[Is OpenBucket for you?](/docs/is-openbucket-for-you) lay out where the line is.

## Try the swap

The whole experiment costs you one `docker run` and a three-line config diff —
and it's just as quick to undo. Start with the
[Docker quickstart](/docs/getting-started/quickstart-docker), and check the
[configuration reference](/docs/reference/configuration) when you outgrow the
defaults.

---

If OpenBucket earns a permanent slot in your `docker-compose.yml`, consider
dropping a ⭐ on [GitHub](https://github.com/ProjectBay/openbucket) — stars are
how small self-hosted projects get found. Hit a compatibility edge with your
SDK of choice? Tell us in
[Discussions](https://github.com/ProjectBay/openbucket/discussions); the
conformance matrix grows from exactly those reports.
