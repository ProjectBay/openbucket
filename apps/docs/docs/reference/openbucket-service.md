---
title: OpenBucketService API
description: The injectable in-process facade for uploading, reading, listing, and deleting objects, managing buckets, and minting presigned URLs.
sidebar_position: 2
---

# OpenBucketService API

`OpenBucketService` is the in-process facade over your object store. Inject it
anywhere in your NestJS app and drive buckets and objects directly — no HTTP
round-trip, no S3 SDK.

```ts
import { Injectable } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';

@Injectable()
export class FilesService {
  constructor(private readonly ob: OpenBucketService) {}

  async save(buf: Buffer) {
    await this.ob.putObject('photos', 'a.jpg', buf, { contentType: 'image/jpeg' });
    return this.ob.presignGetUrl('photos', 'a.jpg', {
      baseUrl: 'https://files.example.com',
      expiresIn: 900,
    });
  }
}
```

The service is exported by `OpenBucketModule`, so it's available once the module
is imported — with or without the admin surface. Every data method runs inside
its own MikroORM `RequestContext`, so it's safe to call from services, cron jobs,
queue consumers, or `OnApplicationBootstrap`. Presign methods are pure crypto —
they touch neither the DB nor the filesystem.

## Buckets

| Method | Signature | What it does |
| --- | --- | --- |
| `listBuckets` | `listBuckets(): Promise<BucketInfo[]>` | List all buckets with their creation time. |
| `bucketExists` | `bucketExists(name: string): Promise<boolean>` | True if the bucket exists. |
| `createBucket` | `createBucket(name: string, opts?: { versioning?: boolean; objectLock?: boolean }): Promise<void>` | Create a bucket, optionally enabling versioning / object-lock at creation. |
| `deleteBucket` | `deleteBucket(name: string): Promise<void>` | Delete an **empty** bucket. |

```ts
await this.ob.createBucket('org-42', { versioning: true });
if (await this.ob.bucketExists('org-42')) { /* … */ }
```

## Objects

| Method | Signature | What it does |
| --- | --- | --- |
| `putObject` | `putObject(bucket, key, body: Readable \| Buffer \| string, opts?: { contentType?: string }): Promise<PutObjectResult>` | Upload or overwrite an object. A stream writes straight to disk. |
| `uploadFrom` | `uploadFrom(source: UploadSource, opts: UploadOptions): Promise<UploadResult>` | One-call helper: sniff content type, validate, derive a safe key, probe image dims, and optionally mint a URL. |
| `getObjectStream` | `getObjectStream(bucket, key): Promise<Readable>` | Open a readable stream of the object's decrypted bytes. |
| `getObjectBuffer` | `getObjectBuffer(bucket, key): Promise<Buffer>` | Read the whole object into a Buffer. |
| `headObject` | `headObject(bucket, key): Promise<ObjectInfo \| null>` | Object metadata (no body), or `null` if absent. |
| `deleteObject` | `deleteObject(bucket, key): Promise<void>` | Delete an object. Idempotent — a missing key resolves without error. |
| `listObjects` | `listObjects(bucket, opts?: { prefix?; delimiter?; marker?; limit? }): Promise<ObjectListResult>` | List objects, with optional folder roll-up and paging. |

```ts
const { etag } = await this.ob.putObject('org-42', 'avatar.png', buf, {
  contentType: 'image/png',
});

const bytes = await this.ob.getObjectBuffer('org-42', 'avatar.png');

// Folder-style browsing: keys roll up under `commonPrefixes`.
const { contents, commonPrefixes, nextMarker, isTruncated } =
  await this.ob.listObjects('org-42', { delimiter: '/', limit: 100 });
```

`listObjects` caps `limit` at 1000 (the default). Page by passing the previous
page's `nextMarker` back as `marker`.

### `uploadFrom` — the one-call helper

Accepts a `Buffer`, a `Readable`, or a multer file
(`{ buffer | stream, mimetype, originalname, size }`). It sniffs the real content
type from magic bytes (the sniffed type wins over the declared one), enforces
size/type/active-content validation, derives a safe key, and returns the stable
identity to persist.

```ts
const res = await this.ob.uploadFrom(file, {
  bucket: 'uploads',
  keyStrategy: 'uuid', // or 'sha256' | 'original' | 'date'
  validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
  presign: { baseUrl: 'https://files.example.com', expiresIn: 3600 },
});
// → { bucket, key, url?, etag, size, contentType, versionId?, image? }
```

Key options on `UploadOptions`: `key` (explicit, wins over `keyStrategy`),
`keyStrategy` (default `'uuid'`), `validate`, `contentType`, `filename`, `image`,
and `presign` (a `PresignOptions` object, or `false` to skip URL minting).

:::warning[Active content is rejected by default]
`uploadFrom` rejects HTML/XHTML/SVG bodies unless you opt in — defense in depth
for the stored-XSS surface. On a rejected upload it throws `UploadValidationError`
(map its `statusHint` of `400` to a `BadRequestException`).
:::

## Presigned URLs

Pure crypto over the root credential — no DB or filesystem access. The `baseUrl`
is the public origin (scheme + host); the configured `mountPath` and object path
are appended for you. `baseUrl` defaults to the `endpoint` option (over `https`)
when set.

| Method | Signature | What it does |
| --- | --- | --- |
| `presignGetUrl` | `presignGetUrl(bucket, key, opts?: PresignOptions): string` | A time-limited signed GET (download) URL. |
| `presignPutUrl` | `presignPutUrl(bucket, key, opts?: PresignOptions): string` | A time-limited signed PUT (upload) URL. |
| `createPresignedPost` | `createPresignedPost(bucket, opts: PresignPostOptions): PresignedPost` | A browser-form direct upload — returns `{ url, fields }`. |

```ts
const download = this.ob.presignGetUrl('photos', 'a.jpg', {
  baseUrl: 'https://files.example.com',
  expiresIn: 900, // seconds, 1 … 7 days
});

// Direct browser upload: append every `fields` entry + the `file` part LAST.
const { url, fields } = this.ob.createPresignedPost('avatars', {
  key: 'users/${filename}',
  contentLengthRange: { min: 1, max: 5 * 1024 * 1024 },
  contentType: { startsWith: 'image/' },
  successActionStatus: '201',
});
```

`PresignOptions` is `{ expiresIn?, baseUrl? }`. `PresignPostOptions` adds
`contentLengthRange`, `contentType` (pin a string or `{ startsWith }`),
`keyStartsWith`, raw `conditions`, and `successActionStatus` /
`successActionRedirect`. A `content-length-range` defaults to the server's
`maxObjectSizeMb` cap when you omit one, so a minted token can never authorise an
object larger than the server allows.

:::note[`baseUrl` is required unless `endpoint` is set]
Presign throws if neither a `baseUrl` nor the `endpoint` option resolves an
origin. Pass `baseUrl: 'https://files.example.com'` (scheme + host only).
:::

## Errors

Methods throw OpenBucket's S3 domain errors — `NoSuchBucketError`,
`NoSuchKeyError`, `BucketNotEmptyError`, `BucketAlreadyOwnedByYouError`, … Catch
them, or pre-check with `bucketExists` / `headObject`. `deleteObject` is the
exception: it's idempotent and never throws on a missing key.

## Result & option types

Exported from `@openbucket/nestjs` alongside the service:

- `PutObjectResult` — `{ etag, versionId? }`
- `UploadResult` — `{ bucket, key, url?, etag, size, contentType, versionId?, image? }`
- `ObjectInfo` — `{ key, size, etag, contentType, lastModified, versionId?, userMetadata? }`
- `ObjectListResult` — `{ contents, commonPrefixes, nextMarker?, isTruncated }`
- `ObjectListEntry` — `{ key, size, etag, lastModified, storageClass }`
- `BucketInfo` — `{ name, createdAt }`
- `PresignedPost` — `{ url, fields }`
- Option types: `UploadOptions`, `UploadSource`, `MulterFileLike`,
  `PresignOptions`, `PresignPostOptions`, `UploadValidateOptions`, `KeyStrategy`.

## Next steps

- [NestJS module reference](./nestjs-module.md) — wire the module and the full recipes.
- [Configuration](./configuration.md) — the options that shape this service.
- [S3 compatibility](./s3-compatibility.md) — drive the same store over the wire.
- [Admin API](./admin-api.md) — administrative operations beyond the data plane.
