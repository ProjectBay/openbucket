---
slug: nestjs-file-uploads-in-10-minutes
title: Add S3-compatible file uploads to a NestJS app in 10 minutes
description: Wire up file uploads in a NestJS app with a self-hosted, S3-compatible object store you install as an npm package — no AWS account, no MinIO container.
authors: [openbucket]
tags: [nestjs, tutorial, file-upload, s3, self-hosted]
date: 2026-07-08
keywords:
  [
    nestjs file upload,
    nestjs upload to s3,
    nestjs multer s3,
    nestjs presigned url,
    self-hosted s3 nodejs,
  ]
---

Every app eventually needs to store files — avatars, attachments, exports. And in
Node/NestJS the usual options are all a bit of a chore: pay for AWS S3 and juggle
credentials, stand up and babysit a MinIO container, or hack something onto local
disk that you'll have to rip out later.

OpenBucket takes a different route: it's an **S3-compatible object store you
`npm install` straight into your NestJS app**. No second service, no container in
local dev, no cloud account. In this tutorial we'll add a working upload endpoint —
with validation and a shareable URL — in about ten minutes.

<!-- truncate -->

## What we're building

A `POST /files` endpoint that accepts a multipart upload, streams it straight into
OpenBucket (no temp file, no `file.buffer` in memory), validates it, and returns a
short-lived URL to fetch it back. The same object store also gives you a bundled
admin console to browse what you uploaded.

## Step 1 — Install

```bash
npm install @openbucket/nestjs
```

`multer` is an optional peer dependency used for the upload pipeline:

```bash
npm install multer
```

## Step 2 — Generate the secrets

OpenBucket refuses to boot with weak or missing secrets. You need an argon2id hash
of your admin password and a couple of random secrets. The package ships a CLI, so
you can mint the hash with **no repository checkout**:

```bash
# argon2id hash for the admin password:
npx @openbucket/nestjs hash 'choose-a-strong-password'

# two random 32-char secrets (JWT signing + the S3 root secret):
openssl rand -hex 32
openssl rand -hex 32
```

Drop them into your environment (e.g. a `.env`):

```bash
OB_ADMIN_HASH='$argon2id$v=19$m=65536,...'   # from `openbucket hash`
OB_JWT_SECRET='…32+ chars…'
OB_ACCESS_KEY_ID='AKIALOCALDEV0000000'         # 16–32 uppercase alphanumerics
OB_SECRET_ACCESS_KEY='…32+ chars…'
```

## Step 3 — Register the module

Mount OpenBucket under a path prefix in your app. Everything — the S3 endpoint, the
admin API, and the admin console — lives under `mountPath`.

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { OpenBucketModule } from '@openbucket/nestjs';
import { FilesController } from './files.controller';

@Module({
  imports: [
    OpenBucketModule.forRoot({
      dataDir: './.openbucket-data', // SQLite + blob payloads live here
      mountPath: '/storage', // S3 endpoint = http://localhost:3000/storage
      rootCredentials: {
        accessKeyId: process.env.OB_ACCESS_KEY_ID!,
        secretAccessKey: process.env.OB_SECRET_ACCESS_KEY!,
      },
      admin: {
        username: 'admin',
        passwordHash: process.env.OB_ADMIN_HASH!,
        jwtSecret: process.env.OB_JWT_SECRET!,
        serveUi: true, // admin console at /storage/admin
      },
    }),
  ],
  controllers: [FilesController],
})
export class AppModule {}
```

## Step 4 — Create a bucket on startup

Create the `uploads` bucket once, when the app boots, using the in-process
`OpenBucketService` (no HTTP round-trip):

```ts title="app.bootstrap.ts"
import { Injectable, OnModuleInit } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';

@Injectable()
export class BucketBootstrap implements OnModuleInit {
  constructor(private readonly ob: OpenBucketService) {}

  async onModuleInit() {
    if (!(await this.ob.bucketExists('uploads'))) {
      await this.ob.createBucket('uploads');
    }
  }
}
```

Add `BucketBootstrap` to your module's `providers`.

## Step 5 — The upload endpoint

Here's the whole thing. `openBucketStorage` is a drop-in multer storage engine, so
`FileInterceptor` streams the part **straight into the store** — no temp file. The
`@UploadedToBucket()` decorator hands you the committed object, and
`UploadValidationExceptionFilter` turns a rejected upload into a clean `HTTP 400`.

```ts title="files.controller.ts"
import {
  Controller,
  Post,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  openBucketStorage,
  UploadedToBucket,
  UploadValidationExceptionFilter,
  type UploadedFileInfo,
} from '@openbucket/nestjs/multer';

@Controller('files')
export class FilesController {
  @Post()
  @UseFilters(UploadValidationExceptionFilter) // rejected upload → HTTP 400
  @UseInterceptors(
    FileInterceptor('file', {
      storage: openBucketStorage({
        bucket: 'uploads',
        key: 'uuid', // generate a safe, unique key
        validate: {
          maxBytes: 10 * 1024 * 1024, // 10 MiB
          allowedContentTypes: ['image/*'], // sniffed, not trusted from the client
        },
      }),
    }),
  )
  upload(@UploadedToBucket() file: UploadedFileInfo) {
    // `file` is already committed to the store:
    // { bucket, key, url?, etag, size, contentType }
    return { key: file.key, url: file.url };
  }
}
```

That's the entire feature. Try it:

```bash
curl -F 'file=@./photo.jpg' http://localhost:3000/files
# → { "key": "a1b2c3…", "url": "http://localhost:3000/storage/uploads/a1b2c3…?X-Amz-…" }
```

A non-image, or anything over 10 MiB, comes back as a `400` with a structured
error — no bytes stored.

## Step 6 — Read it back

`file.url` is a short-lived presigned GET URL. Store the **stable key** in your
database (not the signed URL), and mint a fresh URL whenever you serve the file:

```ts
import { OpenBucketService } from '@openbucket/nestjs';

// somewhere in a service:
const url = this.ob.presignGetUrl('uploads', key, {
  baseUrl: 'http://localhost:3000/storage',
  expiresIn: 3600, // 1 hour
});
```

## Where did the file go?

Open **http://localhost:3000/storage/admin**, sign in with `admin` and your
password, and you'll see the object in the bucket browser — with an inline preview.
That's the payoff of an object store that lives inside your app: the same engine
runs on your laptop and in production, and you didn't stand up a single extra
service.

## Where to go next

- **Direct browser uploads** without bytes touching your server →
  [presigned POST](/docs/guides/sharing-files)
- **On-the-fly image resizing** on GET (`?w=&h=&format=webp`) →
  [image transforms](/docs/guides/image-transforms)
- **Per-tenant scoped keys** for a multi-tenant SaaS →
  [multi-tenancy](/docs/guides/multi-tenancy)
- **Durability**: mirror every object to real S3 / R2 / B2 →
  [replication & tiering](/docs/guides/replication-and-tiering)

Not sure it fits your use case? Read the honest
[Is OpenBucket for you?](/docs/is-openbucket-for-you) guide — it's a single-node
store by design, and we're upfront about when to reach for something else.

---

If this saved you an afternoon, a ⭐ on
[GitHub](https://github.com/ProjectBay/openbucket) genuinely helps others find the
project. Questions? Come say hi in
[Discussions](https://github.com/ProjectBay/openbucket/discussions).
