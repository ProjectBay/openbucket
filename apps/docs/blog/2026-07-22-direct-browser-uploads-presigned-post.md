---
slug: direct-browser-uploads-presigned-post
title: Direct browser uploads with presigned POST — no bytes through your backend
description: Let browsers upload straight to your self-hosted S3 store with presigned POST. Your NestJS server only signs a short-lived policy — full tutorial.
authors: [openbucket]
tags: [nestjs, tutorial, presigned-post, file-upload, s3, browser-uploads]
date: 2026-07-22
keywords:
  [
    s3 presigned post browser upload,
    direct browser upload to s3,
    presigned url upload nestjs,
    s3 post policy tutorial,
    upload file from browser to s3,
    self-hosted s3 presigned post,
  ]
draft: true
---

In [the last tutorial](/blog/nestjs-file-uploads-in-10-minutes) we built a
`POST /files` endpoint where the browser uploads to your NestJS app and the file
streams into OpenBucket. That's a fine default — but notice what happens to every
byte: it enters your server once (browser → API) and leaves it again (API →
store). Double the bandwidth, and your Node process babysits the connection for
the whole transfer. For avatars, who cares. For a 200 MB video, it adds up fast.

**Presigned POST** flips the flow. Your server's only job is to sign a
short-lived policy — a few hundred bytes of JSON — and the browser POSTs the file
**directly to the object store**. No S3 SDK in the browser, no credentials
leaving your server, no file bytes touching your API. Here's the whole thing
end-to-end with OpenBucket.

<!-- truncate -->

## The flow in three steps

1. The browser asks your API: "I want to upload `cat.png`, may I?"
2. Your API mints a **presigned POST** — a `url` plus a set of hidden form
   `fields` containing a signed, expiring policy that says *exactly* what may be
   uploaded (which key, what content type, how many bytes).
3. The browser builds a `FormData` from those fields, appends the file **last**,
   and POSTs it straight to the store. OpenBucket verifies the signature and the
   policy conditions before a single byte is committed.

This post assumes the setup from the
[10-minute tutorial](/blog/nestjs-file-uploads-in-10-minutes): `@openbucket/nestjs`
mounted at `/storage`, secrets in place, and a bucket created on boot — we'll use
one called `avatars`.

## Step 1 — The endpoint that mints the token

Inject `OpenBucketService` and call `createPresignedPost`. It's pure crypto — no
database or filesystem access — so it's cheap to call per upload. We mint an
exact key server-side so both the browser and your database know it up front, with
no response parsing:

```ts title="files.controller.ts"
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';
import { randomUUID } from 'node:crypto';

@Controller('files')
export class FilesController {
  constructor(private readonly ob: OpenBucketService) {}

  @Get('upload-token')
  uploadToken(@Query('filename') filename?: string) {
    const base = (filename ?? '').replace(/^.*[\\/]/, ''); // strip any path
    if (!base) throw new BadRequestException('filename is required');

    const key = `users/${randomUUID()}-${base}`;
    const { url, fields } = this.ob.createPresignedPost('avatars', {
      key, // exact-match condition: this token uploads THIS key, nothing else
      expiresIn: 300, // seconds; default 900, capped at 7 days
      contentType: { startsWith: 'image/' }, // or pin one: 'image/png'
      contentLengthRange: { min: 1, max: 5 * 1024 * 1024 }, // 1 B … 5 MiB
      successActionStatus: '201',
      baseUrl: 'http://localhost:3000', // your public origin; or set the
      //                                   module's `endpoint` option once
    });
    return { url, fields, key };
  }
}
```

`url` is where the browser POSTs (`http://localhost:3000/storage/avatars` here —
origin + `mountPath` + bucket), and `fields` are the hidden inputs carrying the
base64 policy and its SigV4 signature.

Two options worth knowing: `key: 'users/${filename}'` (a literal placeholder,
substituted server-side from the uploaded filename) and `keyStartsWith: true`,
which turns the key into a prefix — a folder-scoped upload token. The full option
table is in the [sharing files guide](/docs/guides/sharing-files).

## Step 2 — The browser upload

No SDK needed — `fetch` and `FormData` do it all. Order matters: every minted
field first, the file part **last** (that's the S3 POST contract, and OpenBucket
ignores fields that arrive after the file):

```js title="upload.js"
async function upload(file) {
  // 1. Ask your API for a signed form.
  const res = await fetch(
    `/files/upload-token?filename=${encodeURIComponent(file.name)}`,
  );
  const { url, fields, key } = await res.json();

  // 2. Build the form: minted fields, then Content-Type, then the file LAST.
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('Content-Type', file.type); // required with a startsWith policy
  form.append('file', file);

  // 3. POST straight to the store — bytes never touch your API.
  const upload = await fetch(url, { method: 'POST', body: form });
  if (!upload.ok) throw new Error(`upload failed: ${upload.status}`);

  return key; // hand this to your API to persist in your DB
}
```

That explicit `Content-Type` field is easy to miss: with
`contentType: { startsWith: 'image/' }` the policy contains a
`starts-with $Content-Type` condition but no fixed value, so the browser must
supply the field itself — omit it and the upload is rejected with a 403. (If you
pin an exact type instead, it's already in `fields` and you can skip that line.)

On success you get `201` with a small `<PostResponse>` XML body (key + ETag)
because we asked for `successActionStatus: '201'`; without it, OpenBucket answers
`204 No Content`. There's also `successActionRedirect` for the no-JavaScript
variant — a plain `<form method="post" enctype="multipart/form-data">` with the
minted fields as hidden inputs works too, and the redirect bounces the user back
to your app afterwards.

## What the policy actually enforces

The token isn't a bearer token for "uploading" — it authorizes one narrowly
described request, verified server-side before commit:

- **Signature first.** The policy is HMAC-signed; one flipped character and the
  request dies with `403` and nothing written.
- **Every condition is checked** — bucket, exact key (or prefix), content type,
  expiry. It fails closed: any submitted form field *not* covered by a policy
  condition is rejected outright.
- **Size is enforced on the wire.** The `content-length-range` is applied to the
  actual streamed bytes, not a client-declared header. And if you forget to set
  one, OpenBucket injects a default capped at the server's `maxObjectSizeMb`
  limit — a minted token can never authorize more than the server allows.
- **Bucket policies still apply.** An explicit `Deny` on the bucket beats a valid
  token.

One honest caveat: `createPresignedPost` signs with the root credential, so treat
minted tokens like the capability grants they are — short `expiresIn`, tight
conditions, and mint them from an authenticated endpoint only.

## CORS — often you need none

If you embed OpenBucket in the same NestJS app that serves your frontend (the
setup from the last post), the browser POSTs to `/storage/avatars` on the **same
origin** — CORS never enters the picture. This is the smoothest path, and worth
preserving with a reverse-proxy route even when your SPA is hosted separately.

When the store genuinely lives on another origin, S3 attaches CORS rules to the
*bucket*, and OpenBucket answers the browser's unsigned `OPTIONS` preflight from
those stored rules. Set them with any S3 client:

```ts title="configure-cors.ts"
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';

await s3.send(
  new PutBucketCorsCommand({
    Bucket: 'avatars',
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ['https://app.example.com'],
          AllowedMethods: ['POST'],
          AllowedHeaders: ['*'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
```

…or click it together in the admin console's per-bucket **CORS** editor. A nice
security detail: a preflight for a missing bucket, a bucket with no CORS config,
and a bucket whose rules don't match all return the same opaque `403`, so
anonymous preflights can't be used to enumerate bucket names. The supported
surface is listed in the [S3 compatibility matrix](/docs/reference/s3-compatibility).

## Step 3 — Read it back

Same rule as always: store the stable `{ bucket, key }` in your database, never a
signed URL. When you serve the file, mint a fresh presigned GET:

```ts
const url = this.ob.presignGetUrl('avatars', key, {
  baseUrl: 'http://localhost:3000',
  expiresIn: 3600, // 1 hour
});
```

And if your server needs to *react* to an upload it never saw — create the DB
row, kick off a thumbnail job — presigned POST uploads emit the same in-process
`@OnObjectCreated()` events and webhooks as any other write. That's the
[events guide](/docs/guides/events-and-webhooks).

## When to use which upload path

- **Through your API** (multer engine or `uploadFrom`) — when you want to inspect
  or transform bytes inline, or the files are small. See
  [file uploads](/docs/guides/file-uploads).
- **Presigned POST** — when files are big or frequent enough that relaying them
  is wasted work, and validation by content type + size range is enough.

OpenBucket is pre-1.0 and single-node by design — the point isn't infinite scale,
it's that direct-to-store uploads keep your app's event loop free even on one
node, and the exact same code works against your laptop and your server.

---

If you ship this and shave a hop off your upload path, consider dropping a star
on [GitHub](https://github.com/ProjectBay/openbucket) — it's the main way people
discover self-hosted tools. And if your presigned-POST setup does something
unusual (huge files? kiosk devices?), we'd love to compare notes in
[Discussions](https://github.com/ProjectBay/openbucket/discussions).
