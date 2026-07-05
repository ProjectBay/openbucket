---
title: Sharing files
description: Hand out time-limited download and upload links, direct-browser-upload tokens, and permanent public URLs.
sidebar_position: 4
---

# Sharing files

Give someone access to an object without giving them a credential. Mint a short-lived signed URL for a download or an upload, a browser-form token for direct uploads, or make a whole bucket public for permanent links.

## A download link in one line

Inject `OpenBucketService` and call `presignGetUrl`. It's pure crypto — no DB or filesystem access — so it's cheap to mint on every read.

```ts
const url = this.ob.presignGetUrl('avatars', 'users/123.png', {
  baseUrl: 'https://files.example.com', // your public origin (scheme + host)
  expiresIn: 3600,                       // seconds; default 900 (15 min)
});
// → https://files.example.com/<mountPath>/avatars/users/123.png?X-Amz-Algorithm=…&X-Amz-Signature=…
```

The link is a normal S3 presigned GET: anyone with it can download the object until it expires, then it's dead. Nothing is world-readable by accident.

## Signing options

Both `presignGetUrl` and `presignPutUrl` take the same options:

```ts
interface PresignOptions {
  expiresIn?: number; // seconds, 1 … 604800 (7 days). Default 900.
  baseUrl?: string;   // public origin, scheme + host only, e.g. 'https://files.example.com'
}
```

- `expiresIn` is clamped to `[1, 7 days]` — 7 days is the S3 maximum for a presigned URL.
- `baseUrl` is the origin your clients actually reach the store at (scheme + host); the bucket, key, and configured `mountPath` are appended for you. It defaults to `` `https://${endpoint}` `` when the module's `endpoint` option is set; otherwise `baseUrl` is required (a call without either throws).

:::note Store the key, presign on read
Persist the stable `{ bucket, key }` in your database — never a signed URL, which expires. Mint a fresh URL each time you read the row. It's a pure hash, so there's no cost to re-minting, and nothing ever goes stale.
:::

## A signed upload link (presigned PUT)

Hand a client a URL they can `PUT` bytes to — useful for server-to-server or CLI uploads without sharing credentials:

```ts
const uploadUrl = this.ob.presignPutUrl('uploads', 'incoming/report.pdf', {
  baseUrl: 'https://files.example.com',
  expiresIn: 900,
});
// The client: PUT the raw file body to `uploadUrl`.
```

The client uploads with a plain HTTP `PUT` (body = the file bytes) — no SDK, no signing on their side.

## Direct browser uploads (presigned POST)

For uploads straight from a browser to OpenBucket — bytes never touch your app — mint a presigned POST. Your server signs a short-lived, tightly-scoped HTML-form token; the browser POSTs the file directly.

```ts
const { url, fields } = this.ob.createPresignedPost('avatars', {
  key: 'users/${filename}',       // literal ${filename} → substituted server-side
  expiresIn: 900,                 // default 900
  contentType: { startsWith: 'image/' }, // or a pinned string like 'image/png'
  contentLengthRange: { min: 1, max: 5 * 1024 * 1024 },
});
```

Return `{ url, fields }` to the browser. The client builds a `FormData`, appends every entry in `fields` (they're hidden form inputs), then appends the `file` part **last**, and POSTs to `url`:

```js
const form = new FormData();
for (const [k, v] of Object.entries(fields)) form.append(k, v);
form.append('file', fileInput.files[0]); // MUST be last
await fetch(url, { method: 'POST', body: form });
```

### POST options

| Option | Effect |
| --- | --- |
| `key` | The object key. A literal `${filename}` placeholder is substituted with the uploaded filename server-side. |
| `expiresIn` | Token lifetime in seconds (1 … 7 days). Default 900. |
| `baseUrl` | Public origin; defaults to `endpoint` like the other presign methods. |
| `contentType` | Pin an exact type (`'image/png'`) or restrict a prefix (`{ startsWith: 'image/' }`). |
| `contentLengthRange` | `{ min, max }` byte bounds on the uploaded file. |
| `keyStartsWith` | `starts-with` the key instead of an exact match — a folder-scoped upload token. |
| `successActionStatus` / `successActionRedirect` | The `2xx` status or redirect the browser gets on success. |
| `conditions` | Raw extra policy conditions (an escape hatch). |

:::info Every POST token is size-capped
If you omit `contentLengthRange`, OpenBucket injects one defaulted to the server's `maxObjectSizeMb` cap, so a minted token can never authorize an object larger than the server allows. The size range is re-enforced on the streamed bytes on the wire.
:::

## Permanent links (public buckets)

For assets you deliberately want world-readable — a public avatar, a marketing image behind a CDN — skip presigning entirely. Attach a bucket policy that allows anonymous `s3:GetObject`, then serve stable path-style URLs.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*"
    }
  ]
}
```

Set it with any S3 client (`PutBucketPolicy`) or the admin console's per-bucket policy editor. Now anyone can `GET` an object in that bucket with no signature, so the permanent URL is simply:

```
https://files.example.com/<mountPath>/my-bucket/<key>
```

(In the standalone app `mountPath` is empty, so the URL is `https://host/my-bucket/<key>`.) These URLs are also what let [image transforms](./image-transforms.md) work from a plain `<img>` tag.

:::warning A public bucket is public
Anonymous `s3:GetObject` means every object in the bucket is world-readable — put only assets you're happy to expose there. For anything private, use the **store the key, presign on read** pattern instead. And remember: a presigned URL signs its full query string, so you can't append extra params (like transform `?w=`) to one after minting.
:::

## Which link do I want?

| Goal | Use |
| --- | --- |
| Let a user download a private object briefly | `presignGetUrl` |
| Let a client upload without credentials | `presignPutUrl` |
| Let a browser upload straight to the store | `createPresignedPost` |
| Serve permanent, world-readable assets | a public-read bucket policy |

## Next steps

- [File uploads](./file-uploads.md) — get objects into the store, including the multer engine.
- [Image transforms](./image-transforms.md) — resize on the fly (works great with public buckets).
- [Events and webhooks](./events-and-webhooks.md) — react when a presigned upload lands.
- [NestJS module reference](../reference/nestjs-module.md) — the `endpoint` option and more.
