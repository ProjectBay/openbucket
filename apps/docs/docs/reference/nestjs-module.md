---
sidebar_position: 6
title: NestJS module reference
---

# NestJS module reference

The full reference for [`@openbucket/nestjs`](https://www.npmjs.com/package/@openbucket/nestjs) —
embed an **S3-compatible object store** (wire protocol, admin JSON API, and admin
console SPA) directly inside your own NestJS application, configured in code. For a
quick orientation, start with [Embedding in NestJS](../getting-started/quickstart-embed.md).

:::tip Deep-dive references
This page covers wiring the module. For the details, see the focused guides:
[Configuration](./configuration.md) (every option + env var),
[OpenBucketService API](./openbucket-service.md) (the injectable facade),
[S3 compatibility](./s3-compatibility.md), the [Admin API](./admin-api.md), and
the [CLI reference](./cli-reference.md).
:::

```ts
import { Module } from '@nestjs/common';
import { OpenBucketModule } from '@openbucket/nestjs';

@Module({
  imports: [
    OpenBucketModule.forRoot({
      dataDir: '/var/lib/openbucket',
      mountPath: '/storage', // S3 endpoint = http://your-host/storage
      rootCredentials: {
        accessKeyId: process.env.OB_ACCESS_KEY!,
        secretAccessKey: process.env.OB_SECRET_KEY!,
      },
      admin: {
        username: 'admin',
        passwordHash: process.env.OB_ADMIN_HASH!, // argon2id
        jwtSecret: process.env.OB_JWT_SECRET!,
        serveUi: true, // admin console at /storage/admin
      },
    }),
  ],
})
export class AppModule {}
```

Point any S3 client at `http://your-host/storage` (path-style) with the root
credentials. The admin console is at `http://your-host/storage/admin`.

## Enabling / disabling the admin surface

The `admin` block is **opt-in** and controls a real wiring switch — not just a flag:

- **Include `admin`** → the JSON admin API (`<mountPath>/api/admin/*`), the global
  JWT auth guard, and the first-run admin bootstrap are all wired. Set
  `serveUi: true` to also serve the bundled Angular console at `<mountPath>/admin`.
- **Omit `admin`** → a **headless, S3-only store**. No admin routes are mapped, no
  JWT guard is bound, no admin user is seeded, and the SPA is never served. Only the
  S3 wire protocol (and the `<mountPath>/api/admin/health` / `ready` probes) respond.

```ts
// Headless: S3 wire protocol only, no admin API and no console.
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  mountPath: '/storage',
  rootCredentials: { accessKeyId: '…', secretAccessKey: '…' },
  // no `admin` → admin surface is entirely absent
});
```

A **partial** `admin` block is rejected at startup (it would otherwise sign JWTs
with an empty secret): `username`, `passwordHash`, and `jwtSecret` are all required
when `admin` is present. Omit the whole block to go headless.

## Async configuration

For secrets resolved at runtime (e.g. from the host's `ConfigService`). Note
`mountPath`, `serveUi`, and `admin` (the on/off switch) are **static** — routing is
wired at module-config time — while the admin *secrets* still come from the factory:

```ts
OpenBucketModule.forRootAsync({
  mountPath: '/storage',
  serveUi: true,
  // admin: false,  // ← set this to run headless; then the factory may omit `admin`
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    dataDir: cfg.getOrThrow('OB_DATA_DIR'),
    rootCredentials: {
      accessKeyId: cfg.getOrThrow('OB_ACCESS_KEY'),
      secretAccessKey: cfg.getOrThrow('OB_SECRET_KEY'),
    },
    admin: { username: 'admin', passwordHash: cfg.getOrThrow('OB_ADMIN_HASH'), jwtSecret: cfg.getOrThrow('OB_JWT_SECRET') },
  }),
});
```

When the admin surface is enabled (the default), the factory **must** return an
`admin` block; pass `admin: false` to run headless and the factory may omit it.

## Using OpenBucket from your code

Two ways to drive the store from your host app — pick by who's calling.

### In-process: inject `OpenBucketService`

For your **server-side code**, inject `OpenBucketService` and call object/bucket
operations directly — no HTTP round-trip. It's exported by `OpenBucketModule`, so
it's available anywhere once the module is imported (works with or without the
admin surface). Each data method runs inside its own MikroORM context, so it's safe
to call from services, cron jobs, queue consumers, or lifecycle hooks.

```ts
import { Injectable } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';

@Injectable()
export class FilesService {
  constructor(private readonly ob: OpenBucketService) {}

  async onboard(orgId: string, avatar: Buffer) {
    await this.ob.createBucket(`org-${orgId}`, { versioning: true });

    // Upload a Buffer, string, or a Readable stream (large files stream to disk).
    const { etag } = await this.ob.putObject(`org-${orgId}`, 'avatar.png', avatar, {
      contentType: 'image/png',
    });

    // Read it back as a Buffer (or `getObjectStream` for large objects).
    const bytes = await this.ob.getObjectBuffer(`org-${orgId}`, 'avatar.png');

    // List with folder-style roll-up, or a flat prefix scan.
    const { contents, commonPrefixes } = await this.ob.listObjects(`org-${orgId}`, {
      delimiter: '/',
    });

    // Mint a time-limited URL to hand to a browser (download or direct upload).
    const downloadUrl = this.ob.presignGetUrl(`org-${orgId}`, 'avatar.png', {
      baseUrl: 'https://files.example.com', // your public origin (scheme + host)
      expiresIn: 900,
    });
    const uploadUrl = this.ob.presignPutUrl(`org-${orgId}`, 'next.png', {
      baseUrl: 'https://files.example.com',
    });

    return { etag, size: bytes.length, downloadUrl, uploadUrl };
  }
}
```

The facade covers: `putObject`, `getObjectStream`, `getObjectBuffer`, `headObject`,
`deleteObject`, `listObjects`; `createBucket`, `deleteBucket`, `bucketExists`,
`listBuckets`; and `presignGetUrl` / `presignPutUrl`. Methods throw OpenBucket's S3
domain errors (`NoSuchBucketError`, `NoSuchKeyError`, …) — catch them or pre-check
with `bucketExists` / `headObject`.

:::tip Presigned URLs
Presigned URLs are signed for the public origin you pass as `baseUrl` (scheme +
host); the configured `mountPath` and the object path are appended for you, so the
URL verifies against the mounted S3 routes. `baseUrl` defaults to the `endpoint`
option (over https) when set. The generated link is a normal S3 URL — hand it to any
HTTP client or `<img src>` / `fetch(url, { method: 'PUT' })`.
:::

### Over the wire: the AWS S3 SDK

For **external clients** (other services, browsers, CLIs), point the standard AWS S3
SDK at the mount — OpenBucket is wire-compatible, so no special client is needed.

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  endpoint: 'http://localhost:3000/storage', // host + mountPath
  region: 'us-east-1', // must match OpenBucket's `region` option (default us-east-1)
  forcePathStyle: true, // REQUIRED — virtual-host addressing is not supported
  credentials: { accessKeyId: process.env.OB_ACCESS_KEY!, secretAccessKey: process.env.OB_SECRET_KEY! },
});

await s3.send(new PutObjectCommand({ Bucket: 'my-bucket', Key: 'a.jpg', Body: buf }));
const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: 'my-bucket', Key: 'a.jpg' }), { expiresIn: 900 });
```

Streaming PUT/GET, multipart uploads (`@aws-sdk/lib-storage`), presigned URLs, range
reads, and object lock all work exactly as they do against AWS.

For **administrative** operations (creating access keys, editing per-bucket
versioning / encryption / lifecycle / CORS / policy, browsing audit events), call
the JSON admin API under `<mountPath>/api/admin/*` — the generated, typed
[`@openbucket/api-client`](https://github.com/ProjectBay/openbucket/tree/main/libs/api-client)
wraps it.

### Recipe: accept file uploads and store their URLs

A very common pattern: your NestJS app takes a browser upload, streams it into
OpenBucket, and saves a row (with a URL) in **your own** database.

**1 — make sure the bucket exists** (once, at startup):

```ts
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';

@Injectable()
export class UploadsBootstrap implements OnApplicationBootstrap {
  constructor(private readonly ob: OpenBucketService) {}

  async onApplicationBootstrap() {
    if (!(await this.ob.bucketExists('uploads'))) {
      await this.ob.createBucket('uploads');
    }
  }
}
```

**2 — the upload endpoint** — parse the multipart file (multer, via
`FileInterceptor`), `putObject` it into OpenBucket, then persist it with your ORM:

```ts
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OpenBucketService } from '@openbucket/nestjs';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from './prisma.service'; // ← your DB; swap for TypeORM / MikroORM / Drizzle

const BUCKET = 'uploads';
const PUBLIC_ORIGIN = 'https://files.example.com'; // where clients reach the store

@Controller('files')
export class FilesController {
  constructor(
    private readonly ob: OpenBucketService,
    private readonly db: PrismaService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file')) // multipart field name: "file"
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');

    // A stable, collision-free key. Keep the extension for tidy URLs.
    const key = `${new Date().getFullYear()}/${randomUUID()}${extname(file.originalname)}`;

    // Stream straight into OpenBucket — in-process, no HTTP round-trip.
    await this.ob.putObject(BUCKET, key, file.buffer, { contentType: file.mimetype });

    // Persist the STABLE identity (bucket + key) — NOT a signed URL (those expire).
    const saved = await this.db.file.create({
      data: {
        bucket: BUCKET,
        key,
        name: file.originalname,
        size: file.size,
        contentType: file.mimetype,
      },
    });

    return this.toDto(saved);
  }

  private toDto(f: { id: string; bucket: string; key: string; name: string }) {
    return {
      id: f.id,
      name: f.name,
      // A fresh, time-limited download URL, minted on demand (pure crypto — no I/O).
      url: this.ob.presignGetUrl(f.bucket, f.key, { baseUrl: PUBLIC_ORIGIN, expiresIn: 3600 }),
    };
  }
}
```

**3 — serve it back.** Because you stored the **key** (not a URL), mint a fresh
presigned URL whenever you read the row — nothing leaks or goes stale:

```ts
const files = await this.db.file.findMany({ where: { ownerId } });
return files.map((f) => this.toDto(f)); // each gets a fresh 1-hour URL
```

:::tip Storing a plain URL column
Either store `presignGetUrl(...)` with a longer `expiresIn` (max **7 days**) and
re-mint it periodically, or — for a bucket you deliberately make public (an
anonymous-GET bucket policy) — store the stable path-style URL
`` `${PUBLIC_ORIGIN}${mountPath}/${bucket}/${key}` ``. The **key + presign-on-read**
pattern above is the robust default: no expiry to babysit and nothing
world-readable by accident.
:::

Notes:

- `FileInterceptor` buffers the file in memory (`file.buffer`), which is fine for
  typical uploads. For large files, pass a `Readable` stream to `putObject`
  instead of a buffer.
- Your app’s multipart parsing is independent of OpenBucket — its S3 routes mount
  under `mountPath` and handle their own request bodies.

## Options

| Option | Required | Default | Notes |
| --- | --- | --- | --- |
| `dataDir` | ✅ | — | SQLite metadata DB + blob payloads + generated `sse.key`. |
| `rootCredentials` | ✅ | — | `{ accessKeyId, secretAccessKey }` (SigV4). |
| `mountPath` | | `/storage` | Path-style prefix for all routes. Virtual-host addressing is not supported. |
| `region` | | `us-east-1` | Region reported to clients (match it in your SDK config). |
| `endpoint` | | — | DNS-safe hostname for endpoint discovery. |
| `sseKey` | | generated | base64 of 32 bytes; else generated + persisted to `<dataDir>/sse.key`. |
| `admin` | | — | **Omit to disable the admin surface entirely** (headless S3-only). When present: `{ username, passwordHash (argon2id), jwtSecret, serveUi?, jwtAccessTtl?, jwtRefreshTtl? }` — `username`/`passwordHash`/`jwtSecret` are all required. |
| `limits` | | | `{ maxObjectSizeMb?, maxMultipartParts?, multipartTtlHours? }`. |

`forRootAsync` adds two **static** options alongside `useFactory`/`inject`:
`serveUi?` (default `true`) and `admin?` (default `true` — set `false` for headless).

## How it coexists with your app

- **Mounting.** Everything mounts under `mountPath`, so OpenBucket's greedy S3
  routes (`:bucket/:key`) never shadow your own routes. Your routes are untouched.
- **Errors.** OpenBucket's exception filter only renders requests under `mountPath`;
  errors on your routes fall through to your own filters / Nest's default.
- **Auth.** When admin is enabled, the admin JWT guard only protects
  `<mountPath>/api/admin/*`. When disabled, no global guard is bound at all.
- **Migrations** run automatically on module init (no manual step).

## Caveats

- **Body parsing.** The S3 protocol needs raw, unbuffered request bodies. Do **not**
  apply a global JSON/body parser to `mountPath` in your host app.
- **MikroORM.** OpenBucket runs its own MikroORM (SQLite) instance under an isolated
  context, so it won't collide with a host app's database.
- **Graceful shutdown.** Call `app.enableShutdownHooks()` in your bootstrap so
  OpenBucket's in-flight-drain (`OnApplicationShutdown`) runs on termination.
- **Node** ≥ 20 (libsql native bindings — N-API prebuilds, ABI-stable across Node majors).
