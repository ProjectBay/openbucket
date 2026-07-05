---
title: Your first upload
description: Accept a file upload in your NestJS app, stream it straight into OpenBucket, save the stable key in your database, and serve a fresh presigned URL on read.
sidebar_position: 3
---

# Your first upload

You'll take a browser file upload, stream it straight into OpenBucket, store the object's **key** in your own database, and hand back a fresh, time-limited URL whenever you read the row. This is the pattern nearly every app needs — and OpenBucket makes it one line.

This tutorial assumes you've already [embedded OpenBucket](./quickstart-embed.md) and can inject `OpenBucketService`.

## The one-liner: a multer storage engine

If your app already uses NestJS's `FileInterceptor`, swap its storage for OpenBucket. The file streams **straight into the store** — no temp file, no `file.buffer`, no explicit upload call. The engine sniffs the real content type, validates it, picks a safe key, and commits the object; `@UploadedToBucket()` then hands your handler the finished `{ bucket, key, url, etag, size, contentType }`.

These three symbols ship behind the dedicated **`@openbucket/nestjs/multer`** subpath:

```ts
import { Controller, Post, UseFilters, UseInterceptors } from '@nestjs/common';
import {
  UploadedToBucket,
  UploadValidationExceptionFilter,
  type UploadedFileInfo,
} from '@openbucket/nestjs/multer';
import { OpenBucketFileInterceptor } from './open-bucket-file.interceptor'; // ← defined below

@Controller('files')
@UseFilters(UploadValidationExceptionFilter) // a rejected upload → HTTP 400
export class FilesController {
  @Post()
  @UseInterceptors(
    OpenBucketFileInterceptor('file', {
      bucket: 'uploads',
      key: 'uuid', // built-in strategy → `${year}/${uuid}${ext}`
      validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
    }),
  )
  upload(@UploadedToBucket() file: UploadedFileInfo) {
    // Already committed to OpenBucket. Persist the STABLE key, not the signed url.
    return { key: file.key, contentType: file.contentType, size: file.size };
  }
}
```

That's the whole upload path. Post a `multipart/form-data` request with a `file` part and the bytes land in the `uploads` bucket, content-sniffed and size-checked.

:::tip Why `contentType` is trustworthy
The engine sniffs the type from the body's magic bytes and the **sniffed type wins** over whatever the client declared — so a "PNG" that's really HTML is caught and rejected, not stored. `file.contentType` is the resolved, verified type.
:::

### Wire up the DI-friendly interceptor

The storage engine needs the `OpenBucketService` **instance**, but inside a class-property `@UseInterceptors(...)` decorator `this` isn't available yet. The fix is a tiny `mixin` interceptor that receives `ob` from the container and builds the engine at construction. Define it once and reuse it everywhere:

```ts
// open-bucket-file.interceptor.ts
import { Injectable, mixin, type NestInterceptor, type Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OpenBucketService } from '@openbucket/nestjs';
import { openBucketStorage, type OpenBucketStorageOptions } from '@openbucket/nestjs/multer';

/** A `FileInterceptor` whose storage is a DI-resolved OpenBucket engine. */
export function OpenBucketFileInterceptor(
  field: string,
  opts: OpenBucketStorageOptions,
): Type<NestInterceptor> {
  @Injectable()
  class OpenBucketInterceptor implements NestInterceptor {
    private readonly delegate: NestInterceptor;
    constructor(ob: OpenBucketService) {
      const Base = FileInterceptor(field, { storage: openBucketStorage(ob, opts) });
      this.delegate = new Base();
    }
    intercept(...args: Parameters<NestInterceptor['intercept']>) {
      return this.delegate.intercept(...args);
    }
  }
  return mixin(OpenBucketInterceptor);
}
```

## Make sure the bucket exists

The engine writes into an existing bucket — it won't create one. Create `uploads` once at startup:

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

:::note Why the exception filter matters
`UploadValidationExceptionFilter` is scoped to `UploadValidationError`, so it turns a too-large / disallowed-type / active-content upload into a clean `400` — but it deliberately does **not** swallow an S3 error like `NoSuchBucketError`. If you skip the bootstrap above, an upload to a missing bucket surfaces as a real error, not a silent `400`.
:::

## Prefer the lower-level primitive?

If you'd rather control parsing and keys yourself, use `OpenBucketService.uploadFrom` with a plain `FileInterceptor`. One call sniffs the content type, enforces your rules, derives a safe key, and streams the body in — then you persist the stable `{ bucket, key }` and return a presigned URL on read:

```ts
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OpenBucketService, UploadValidationError } from '@openbucket/nestjs';
import { PrismaService } from './prisma.service'; // ← your DB; swap for TypeORM / Drizzle / etc.

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

    try {
      const { key, contentType, size, image } = await this.ob.uploadFrom(file, {
        bucket: BUCKET,
        keyStrategy: 'uuid', // → `${year}/${uuid}${ext}`
        validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
      });

      // Persist the STABLE identity (bucket + key) — NOT a signed URL (those expire).
      const saved = await this.db.file.create({
        data: {
          bucket: BUCKET,
          key,
          name: file.originalname,
          size,
          contentType, // the RESOLVED (sniffed) type, not the client's claim
          width: image?.width, // image metadata, when the body probed as an image
          height: image?.height,
        },
      });

      return this.toDto(saved);
    } catch (err) {
      if (err instanceof UploadValidationError) throw new BadRequestException(err.message);
      throw err;
    }
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

The built-in `keyStrategy` values are `'uuid'`, `'uuid-flat'`, `'sha256'` (content-addressed), and `'original'` (sanitized filename). You can also pass a `(ctx) => string` function — its result is always run through the anti-traversal `assertSafeKey` gate.

:::info `putObject` is the raw primitive
Want no sniffing or validation and to pick the key entirely yourself? `this.ob.putObject(bucket, key, body, { contentType })` writes a `Buffer`, string, or `Readable` directly. `uploadFrom` is sugar on top of it.
:::

## Presign a URL and serve it back

Because you stored the **key** — not a URL — you mint a fresh presigned URL every time you read the row. Nothing leaks and nothing goes stale:

```ts
const files = await this.db.file.findMany({ where: { ownerId } });
return files.map((f) => this.toDto(f)); // each gets a fresh 1-hour URL
```

`presignGetUrl` is pure crypto over your root credentials — no DB or filesystem access. `expiresIn` is in seconds and caps at 7 days. `baseUrl` is your public origin (scheme + host); OpenBucket appends the `mountPath` and object path for you.

:::warning Store the key, not the URL
Presigned URLs expire, so persisting one as a column means dead links later. The robust default is **store `{ bucket, key }`, presign on read**. If you truly want a URL column, either re-mint it periodically with a longer `expiresIn`, or — for a bucket you deliberately make public with an anonymous-GET policy — store the stable path-style URL `` `${PUBLIC_ORIGIN}${mountPath}/${bucket}/${key}` ``.
:::

## Handle large files and arrays

- **Large files.** `uploadFrom` also accepts a `Readable` (or a disk-storage multer file) and streams it straight to disk without buffering — only a small header is peeked for sniffing, and `validate.maxBytes` aborts an oversize stream mid-write, committing no partial object.
- **Multiple files.** Use `FilesInterceptor` inside the same mixin and read a `UploadedFileInfo[]` via `@UploadedToBucket()`; for `FileFieldsInterceptor`, pass a field name to `@UploadedToBucket('avatar')`.

## Next steps

- [Core concepts](./core-concepts.md) — keys, prefixes, buckets, and how presigning works.
- [NestJS module reference](../reference/nestjs-module.md) — the full `OpenBucketService` method list.
- [Embed in a NestJS app](./quickstart-embed.md) — the module setup this tutorial builds on.
