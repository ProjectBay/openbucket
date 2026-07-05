---
title: Embed in a NestJS app
description: Add a complete S3-compatible object store — wire protocol, admin API, and admin console — to your own NestJS app in code with OpenBucketModule.
sidebar_position: 2
---

# Embed OpenBucket in a NestJS app

You'll mount a full object store — the S3 wire protocol, the admin JSON API, and the bundled admin console — inside your existing NestJS app, configured entirely in code. No separate container, no extra process.

## Do it now

Install the package:

```bash
npm install @openbucket/nestjs
```

Import the module and pass your config:

```ts
import { Module } from '@nestjs/common';
import { OpenBucketModule } from '@openbucket/nestjs';

@Module({
  imports: [
    OpenBucketModule.forRoot({
      dataDir: '/var/lib/openbucket',
      mountPath: '/storage', // everything mounts under here (default /storage)
      rootCredentials: {
        accessKeyId: process.env.OB_ACCESS_KEY!,
        secretAccessKey: process.env.OB_SECRET_KEY!,
      },
      admin: {
        username: 'admin',
        passwordHash: process.env.OB_ADMIN_HASH!, // argon2id
        jwtSecret: process.env.OB_JWT_SECRET!,
        serveUi: true, // serve the admin console at /storage/admin
      },
    }),
  ],
})
export class AppModule {}
```

Start your app and point any S3 client at `http://your-host:3000/storage` (path-style, root credentials). The admin console is at `http://your-host:3000/storage/admin`.

:::tip Generating the argon2id hash
`admin.passwordHash` is an argon2id hash, never a plaintext password. Generate one with the repo helper: `node scripts/hash-password.mjs 'your-admin-password'`. `jwtSecret` and `rootCredentials.secretAccessKey` must each be at least 32 chars, and `passwordHash` must be a real argon2id string — the module validates all of this at boot and throws if it's wrong.
:::

## What mounts where

Everything lives under `mountPath`, so OpenBucket's greedy S3 routes never shadow your own. With `mountPath: '/storage'`:

| Surface | Path |
| --- | --- |
| S3 endpoint | `http://<host><mountPath>` — e.g. `http://localhost:3000/storage` |
| Admin JSON API | `<mountPath>/api/admin/*` |
| Admin console (when `serveUi: true`) | `<mountPath>/admin` |
| Health / readiness | `<mountPath>/api/admin/health`, `/ready` |

Your own routes are untouched, and OpenBucket's exception filter only renders errors for requests under `mountPath`.

:::warning Don't body-parse the mount
The S3 protocol needs raw, unbuffered request bodies. Do **not** apply a global JSON/body parser to `mountPath` in your host app. Also call `app.enableShutdownHooks()` in your bootstrap so OpenBucket's in-flight drain runs on `SIGTERM`.
:::

## The core options

`forRoot` takes one options object. The essentials:

| Option | Required | Default | Notes |
| --- | --- | --- | --- |
| `dataDir` | yes | — | SQLite metadata DB + blob payloads + generated `sse.key`. Created on boot if absent. |
| `rootCredentials` | yes | — | `{ accessKeyId, secretAccessKey }` (SigV4). |
| `mountPath` | | `/storage` | Path-style prefix for all routes. |
| `region` | | `us-east-1` | Region reported to clients — match it in your SDK. |
| `endpoint` | | — | DNS-safe hostname for endpoint discovery / presign defaults. |
| `admin` | | — | Omit to run headless (see below). When present, `username` / `passwordHash` / `jwtSecret` are all required. |

The `admin` block also accepts `serveUi` (default `true`), `jwtAccessTtl` (default `900`s), and `jwtRefreshTtl` (default `604800`s). See the [NestJS module reference](../reference/nestjs-module.md) for the complete list, including `limits`, `replication`, `backups`, `metrics`, and `tracing`.

## Resolve secrets at runtime with `forRootAsync`

Pull secrets from your host's `ConfigService` instead of hard-coding them. Note that `mountPath`, `serveUi`, and `admin` (the on/off switch) are **static** — routing is wired at config time — while the admin *secrets* still come from your factory:

```ts
import { ConfigService } from '@nestjs/config';
import { OpenBucketModule } from '@openbucket/nestjs';

OpenBucketModule.forRootAsync({
  mountPath: '/storage',
  serveUi: true,
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    dataDir: cfg.getOrThrow('OB_DATA_DIR'),
    rootCredentials: {
      accessKeyId: cfg.getOrThrow('OB_ACCESS_KEY'),
      secretAccessKey: cfg.getOrThrow('OB_SECRET_KEY'),
    },
    admin: {
      username: 'admin',
      passwordHash: cfg.getOrThrow('OB_ADMIN_HASH'),
      jwtSecret: cfg.getOrThrow('OB_JWT_SECRET'),
    },
  }),
});
```

When the admin surface is enabled (the default), the factory **must** return an `admin` block. Pass `admin: false` alongside `useFactory` to run headless, and the factory may then omit it.

## Run headless (S3 only, no admin)

The `admin` block is a real wiring switch, not just a flag. Omit it and you get a **headless, S3-only store**: no admin API, no JWT guard, no seeded admin user, no console — just the S3 wire protocol plus the health probes.

```ts
// Headless — S3 wire protocol only.
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  mountPath: '/storage',
  rootCredentials: {
    accessKeyId: process.env.OB_ACCESS_KEY!,
    secretAccessKey: process.env.OB_SECRET_KEY!,
  },
  // no `admin` key → the entire admin surface is absent
});
```

:::note Partial admin blocks are rejected
A present-but-partial `admin` block fails at startup — it would otherwise sign JWTs with an empty secret. Supply all three of `username`, `passwordHash`, and `jwtSecret`, or omit the block entirely.
:::

## Use it from your code

Once the module is imported, inject `OpenBucketService` anywhere to drive the store in-process — no HTTP round-trip:

```ts
import { Injectable } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';

@Injectable()
export class FilesService {
  constructor(private readonly ob: OpenBucketService) {}

  async save(buf: Buffer) {
    await this.ob.putObject('my-bucket', 'a.jpg', buf, { contentType: 'image/jpeg' });
    return this.ob.presignGetUrl('my-bucket', 'a.jpg', {
      baseUrl: 'https://files.example.com',
      expiresIn: 900,
    });
  }
}
```

:::info Requirements
`@openbucket/nestjs` targets **Node 20.19+** and NestJS 11 (`@nestjs/common`, `@nestjs/core`, and `@nestjs/platform-express` are peer dependencies).
:::

## Next steps

- [Your first upload](./first-upload.md) — accept a file and store it with the one-line multer engine.
- [Core concepts](./core-concepts.md) — mountPath, buckets, keys, and the two auth worlds.
- [NestJS module reference](../reference/nestjs-module.md) — every option, method, and admin route.
- [Quickstart with Docker](./quickstart-docker.md) — the standalone container instead.
