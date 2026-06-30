---
sidebar_position: 3
title: Embedding in NestJS
---

# Embedding in NestJS

Instead of running OpenBucket as a separate service, you can mount a complete
object store — S3 wire protocol, admin API, and admin console — inside your own
NestJS application with [`@openbucket/nestjs`](https://www.npmjs.com/package/@openbucket/nestjs).

```bash
npm install @openbucket/nestjs
```

## `forRoot`

```ts
import { Module } from '@nestjs/common';
import { OpenBucketModule } from '@openbucket/nestjs';

@Module({
  imports: [
    OpenBucketModule.forRoot({
      dataDir: '/var/lib/openbucket',
      mountPath: '/storage', // S3 + admin mount under here (default /storage)
      rootCredentials: {
        accessKeyId: process.env.OB_ACCESS_KEY_ID!,
        secretAccessKey: process.env.OB_SECRET_ACCESS_KEY!,
      },
      admin: {
        username: 'admin',
        passwordHash: process.env.OB_ADMIN_PASSWORD_HASH!, // argon2id
        jwtSecret: process.env.OB_JWT_SECRET!,
        serveUi: true, // serve the bundled admin SPA at /storage/admin
      },
    }),
  ],
})
export class AppModule {}
```

Your S3 endpoint becomes `http://<host><mountPath>` (e.g.
`http://localhost:3000/storage`), the admin API mounts at `<mountPath>/api/admin`,
and the console at `<mountPath>/admin`. Use
`forRootAsync({ useFactory, inject })` to pull secrets from your host's
`ConfigService`.

## Enable or disable the admin surface

The `admin` block is an on/off switch for the whole admin surface:

- **With `admin`** — the JSON admin API (`<mountPath>/api/admin/*`), the JWT auth
  guard, and (when `serveUi: true`) the Angular console are wired.
- **Without `admin`** — a **headless, S3-only store**: no admin API, no JWT
  guard, no console, no seeded admin user. Just the S3 wire protocol (plus
  health probes).

```ts
// Headless — S3 only, no admin API or console:
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  mountPath: '/storage',
  rootCredentials: {
    accessKeyId: process.env.OB_ACCESS_KEY_ID!,
    secretAccessKey: process.env.OB_SECRET_ACCESS_KEY!,
  },
  // no `admin` key → admin surface is entirely absent
});
```

## Use it from your own code

For **server-side code**, inject `OpenBucketService` — upload, read, list,
delete, manage buckets, and mint presigned URLs in-process, with no HTTP
round-trip:

```ts
import { Injectable } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';

@Injectable()
export class FilesService {
  constructor(private readonly ob: OpenBucketService) {}

  async save(buf: Buffer) {
    await this.ob.putObject('my-bucket', 'a.jpg', buf, {
      contentType: 'image/jpeg',
    });
    return this.ob.presignGetUrl('my-bucket', 'a.jpg', {
      baseUrl: 'https://files.example.com',
      expiresIn: 900,
    });
  }
}
```

`OpenBucketService` covers `putObject` / `getObjectStream` / `getObjectBuffer` /
`headObject` / `deleteObject` / `listObjects` / `listBuckets` / `bucketExists` /
`createBucket` / `deleteBucket` / `presignGetUrl` / `presignPutUrl`.

## Use it from external clients

For **external clients** (browsers, other services), point the standard **AWS S3
SDK** at the mount — OpenBucket is wire-compatible:

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://localhost:3000/storage', // host + mountPath
  region: 'us-east-1',
  forcePathStyle: true, // required — virtual-host addressing is not supported
  credentials: { accessKeyId, secretAccessKey },
});

await s3.send(
  new PutObjectCommand({ Bucket: 'my-bucket', Key: 'a.jpg', Body: buf }),
);
```

The full option list, async configuration, and coexistence/caveats live in the
[NestJS module reference](./nestjs-module.md).
