---
title: File uploads
description: Upload files into OpenBucket from your NestJS app — the uploadFrom helper, the multer storage engine, and direct browser uploads.
sidebar_position: 1
---

# File uploads

Get a file from a browser (or your own code) into OpenBucket safely — content sniffed, size capped, key sanitized — in one call. This guide covers the three ways to do it and when to reach for each.

## The one call you'll use most

Inject `OpenBucketService` and hand `uploadFrom` a multer file, a `Buffer`, or a `Readable`. It sniffs the real content type, enforces your rules, derives a safe key, streams the body to disk, and hands back a stable `{ bucket, key, etag, size, contentType }`.

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

@Controller('files')
export class FilesController {
  constructor(private readonly ob: OpenBucketService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file')) // multipart field name: "file"
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');

    const { bucket, key, contentType, size } = await this.ob.uploadFrom(file, {
      bucket: 'uploads',
      keyStrategy: 'uuid',
      validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
    });

    // Persist the STABLE identity (bucket + key) — never a signed URL (those expire).
    return { bucket, key, contentType, size };
  }
}
```

The bucket must already exist — create it once at boot with `this.ob.createBucket('uploads')` (it throws if you upload into a missing bucket).

## What `uploadFrom` does for you

`uploadFrom(source, options)` accepts three body shapes and normalizes them:

- a **multer file** — `{ buffer, mimetype, originalname, size }` (memory storage) or `{ stream, ... }` (disk/stream storage);
- a raw **`Buffer`**;
- a **`Readable`** stream — never fully buffered, only a small header is peeked for sniffing.

It returns an `UploadResult`:

```ts
interface UploadResult {
  bucket: string;
  key: string;
  url?: string;         // present when an origin resolves (see "Minting a URL")
  etag: string;
  size: number;
  contentType: string;  // the RESOLVED (sniffed) type, not the client's claim
  versionId?: string;   // present on versioning-enabled buckets
  image?: { width, height, ... }; // present when the body probes as an image
}
```

### Validation

Pass a `validate` block. Every rule is enforced before (or, for streams, during) the write:

```ts
validate: {
  maxBytes: 10 * 1024 * 1024,          // hard byte cap
  allowedContentTypes: ['image/*', 'application/pdf'], // exact or `family/*`
  rejectActiveContent: true,           // default true — blocks HTML/XHTML/SVG
  sniffContentType: 'prefer',          // 'prefer' | 'require' | 'off'
}
```

- `maxBytes` defaults to the server's `maxObjectSizeMb` cap when omitted. For a known-size body it rejects up front; for a stream the writer aborts mid-write and unlinks the staged blob (no object is committed).
- `allowedContentTypes` matches against the **resolved** type, so a `.png` that is really HTML never sneaks past an `['image/*']` allowlist.
- `rejectActiveContent` (on by default) refuses anything that sniffs as active content — HTML, XHTML, or SVG — defense in depth for the stored-XSS surface.
- `sniffContentType` picks the resolution mode: `'prefer'` sniffs and falls back to the declared type, `'require'` demands a successful sniff (else rejects), `'off'` trusts the declared type.

A rejected upload throws `UploadValidationError` with a stable `code` (`too_large`, `active_content`, `type_not_allowed`, `no_content_type`, `invalid_key`) and a `statusHint` of `400`.

:::warning[Map rejections to HTTP 400]
`UploadValidationError` is not an HTTP exception. Catch it and map it, or use the ready-made filter (see the multer section):

```ts
if (err instanceof UploadValidationError) {
  throw new BadRequestException(err.message);
}
```
:::

### Key strategies

`keyStrategy` decides the object key. Pass a built-in name or your own function:

| Strategy | Result shape | Use it for |
| --- | --- | --- |
| `'uuid'` (default) | `` `${year}/${uuid}${ext}` `` | Collision-free, date-partitioned keys. |
| `'uuid-flat'` | `` `${uuid}${ext}` `` | A flat namespace. |
| `'sha256'` | `` `${sha[:2]}/${sha}${ext}` `` | Content-addressed, deduplicated storage. |
| `'original'` | sanitized `` `${base}${ext}` `` | Human-readable keys (falls back to `uuid` when the name sanitizes to empty). |
| `(ctx) => string` | your value | Custom layouts, e.g. per-tenant prefixes. |

```ts
// Custom key — still sanitized: the return value is run through assertSafeKey.
keyStrategy: (ctx) => `tenant/${tenantId}/${randomUUID()}${ctx.ext}`,
```

The `sha256` strategy is idempotent: re-uploading identical bytes lands on the same key and returns the existing object. Give an explicit `key` instead of a strategy to write to a fixed path (it wins over `keyStrategy`).

:::info[Every key is sanitized]
Custom key functions and the `'original'` strategy pass through `assertSafeKey`, which rejects empty keys, a leading `/`, `.`/`..` traversal segments, control characters, and over-long keys/segments. A raw client filename is never used verbatim.
:::

### Content sniffing

The sniffed type **always wins** over the caller-declared type when present (in `'prefer'`/`'require'` mode), because the declared type is untrusted. This is the gate that catches "a PNG that is really HTML." The resolved type is what gets stored and returned — persist `result.contentType`, not `file.mimetype`.

### Minting a URL on upload

By default `uploadFrom` mints a presigned GET `url` on the result **only when an origin is resolvable** — either you pass `presign.baseUrl`, or the module has an `endpoint` configured. Control it explicitly:

```ts
presign: { baseUrl: 'https://files.example.com', expiresIn: 3600 } // custom
presign: false                                                     // never mint
```

The robust pattern, though, is to store the stable `{ bucket, key }` and mint a fresh URL on read — see [Sharing files](./sharing-files.md).

## Option 2: the multer storage engine

If your app already uses `FileInterceptor`, swap its storage for OpenBucket's engine and the file streams **straight into the store** — no temp file, no `file.buffer`, no explicit `uploadFrom` call. It ships behind the dedicated `@openbucket/nestjs/multer` subpath.

```ts
import { Controller, Post, UseFilters, UseInterceptors } from '@nestjs/common';
import {
  UploadedToBucket,
  UploadValidationExceptionFilter,
  type UploadedFileInfo,
} from '@openbucket/nestjs/multer';
import { OpenBucketFileInterceptor } from './open-bucket-file.interceptor'; // see below

@Controller('files')
@UseFilters(UploadValidationExceptionFilter) // maps a rejected upload → HTTP 400
export class FilesController {
  @Post()
  @UseInterceptors(
    OpenBucketFileInterceptor('file', {
      bucket: 'uploads',
      key: 'uuid', // built-in name OR a (req, file) => string function (always sanitized)
      validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
    }),
  )
  upload(@UploadedToBucket() file: UploadedFileInfo) {
    return { key: file.key, contentType: file.contentType, size: file.size };
  }
}
```

`@UploadedToBucket()` hands your handler the clean commit result (`bucket`, `key`, `url?`, `etag`, `size`, `contentType`, `versionId?`, `image?`) — no reaching into `file.openBucket` by hand. For an array of files it returns `UploadedFileInfo[]`; for a `FileFieldsInterceptor` pass a field name, `@UploadedToBucket('avatar')`.

`UploadValidationExceptionFilter` renders a rejected upload as a stable `{ statusCode: 400, error: 'Bad Request', code, message }` body instead of an opaque 500. It is scoped by `@Catch(UploadValidationError)`, so an S3 error like `NoSuchBucketError` is **not** swallowed — make sure the bucket exists first.

### The `this.ob` wiring helper

`openBucketStorage` needs the `OpenBucketService` instance, but inside a class-property `@UseInterceptors(...)` decorator `this` is not available. The DI-friendly fix is a one-time mixin interceptor that receives `ob` from the container:

```ts
// open-bucket-file.interceptor.ts
import { Injectable, mixin, type NestInterceptor, type Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OpenBucketService } from '@openbucket/nestjs';
import { openBucketStorage, type OpenBucketStorageOptions } from '@openbucket/nestjs/multer';

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

The engine's `bucket`, `key`, and `validate` options can each be a static value or a `(req, file) => …` function, so you can derive the bucket or key per request. If a later part of the request fails, multer calls the engine's rollback, which deletes the already-committed object.

:::tip[Pair the two size caps]
Set `validate.maxBytes` (enforced mid-write, after busboy) alongside multer's own `limits.fileSize` (an early busboy-layer cut-off) for defense in depth.
:::

## Option 3: direct browser uploads (presigned POST)

To upload straight from the browser to OpenBucket — no bytes through your app — mint a presigned POST. Your server signs a short-lived, tightly-scoped HTML-form token; the browser POSTs the file directly.

```ts
const { url, fields } = this.ob.createPresignedPost('avatars', {
  key: 'users/${filename}',       // literal ${filename} → S3 substitutes it server-side
  expiresIn: 900,                 // seconds, 1 … 7 days (default 900)
  contentType: { startsWith: 'image/' },
  contentLengthRange: { min: 1, max: 5 * 1024 * 1024 },
});
// → hand `url` + `fields` to the browser; append the `file` part LAST.
```

The returned `fields` are hidden form inputs; the browser builds `FormData`, appends every field, then appends the `file` part **last**, and POSTs to `url`. A `contentLengthRange` defaults to the server's `maxObjectSizeMb` cap when you omit one, so a token can never authorize an object larger than the server allows. Full walkthrough in [Sharing files](./sharing-files.md#direct-browser-uploads-presigned-post).

## When to use which

| You want… | Reach for |
| --- | --- |
| Bytes flow through your app; you add DB rows, resize, etc. | `uploadFrom` |
| You already use `FileInterceptor` and want the least glue | the multer storage engine |
| Bytes should skip your app entirely (large files, scale) | presigned POST |
| A no-frills primitive: your key, no sniffing/validation | `putObject` |

`putObject(bucket, key, body, { contentType })` is the low-level write; `uploadFrom` is sugar on top of it that adds sniffing, validation, and key strategies.

## Next steps

- [Sharing files](./sharing-files.md) — mint download URLs and direct-upload tokens.
- [Image transforms](./image-transforms.md) — resize and re-encode images on the fly.
- [Events and webhooks](./events-and-webhooks.md) — react to each committed upload.
- [NestJS module reference](../reference/nestjs-module.md) — the full option list.
