# @openbucket/nestjs

Embed an **S3-compatible object store** — wire protocol, admin JSON API, and admin
console SPA — directly inside your own NestJS application, configured in code.

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

The facade covers: `putObject`, `uploadFrom`, `getObjectStream`, `getObjectBuffer`,
`headObject`, `deleteObject`, `listObjects`; `createBucket`, `deleteBucket`,
`bucketExists`, `listBuckets`; `presignGetUrl` / `presignPutUrl`; and
`createPresignedPost`. Methods throw OpenBucket's S3 domain errors
(`NoSuchBucketError`, `NoSuchKeyError`, …) — catch them or pre-check with
`bucketExists` / `headObject`. `uploadFrom` additionally throws
`UploadValidationError` (map its `statusHint` `400`) on a rejected upload.

> **Presigned URLs** are signed for the public origin you pass as `baseUrl` (scheme
> + host); the configured `mountPath` and the object path are appended for you, so
> the URL verifies against the mounted S3 routes. `baseUrl` defaults to the
> `endpoint` option (over https) when set. The generated link is a normal S3 URL —
> hand it to any HTTP client or `<img src>` / `fetch(url, { method: 'PUT' })`.

### Direct browser uploads (presigned POST)

`createPresignedPost` mints a short-lived, tightly-scoped HTML-form upload token so
a browser can upload straight to the store — no S3 SDK in the browser, no proxying
bytes through your server:

```ts
// Server: mint the form. Signed with the root credential; scoped to the
// key/prefix, content-type, and size range you specify.
const { url, fields } = this.ob.createPresignedPost('avatars', {
  key: 'users/${filename}',                // ${filename} filled from the file part
  keyStartsWith: true,                     // folder-scoped upload token
  contentLengthRange: { min: 1, max: 5 * 1024 * 1024 },
  contentType: { startsWith: 'image/' },
  expiresIn: 900,                          // 1 … 604800 s (7 days max)
  successActionStatus: '201',              // 201 → <PostResponse> XML, else 204
});
```

```js
// Browser: append every `fields` entry, then the `file` part LAST, and POST to `url`.
const form = new FormData();
for (const [k, v] of Object.entries(fields)) form.append(k, v);
form.append('file', fileInput.files[0]); // MUST be last
await fetch(url, { method: 'POST', body: form });
```

> **Security & limits.** The server re-enforces the size range on the *streamed*
> bytes (never the client-declared `Content-Length`), the token expires (≤ 7 days),
> and the bucket policy still applies. A `content-length-range` defaults to the
> server's `maxObjectSizeMb` cap when you omit one. The `file` part must be last.
>
> **CORS.** A cross-origin `multipart/form-data` POST is a CORS "simple request"
> (no preflight), so the upload works, but reading a non-2xx error or `201` body
> cross-origin needs per-bucket CORS (`PutBucketCors`). For pure browser flows,
> prefer `successActionRedirect` — the browser navigates and needs no CORS to see
> the result.

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
[`@openbucket/api-client`](../api-client) wraps it.

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
`FileInterceptor`) and hand it to `uploadFrom`. One call sniffs the real content
type, enforces your size/type rules, picks a safe key, and streams the body in —
then persist the stable `{ bucket, key }` with your ORM:

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

    // Sniffs the real content type, enforces size/type, picks a safe key — one call.
    const { key, contentType, size, image } = await this.ob.uploadFrom(file, {
      bucket: BUCKET,
      keyStrategy: 'uuid', // → `${year}/${uuid}${ext}` (same stable, collision-free shape)
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

> **Rejected uploads → 400.** A too-large, disallowed-type, or active-content
> (HTML/SVG masquerading as an image) upload throws `UploadValidationError`. Map it
> to a `400` — e.g. a one-line filter `if (err instanceof UploadValidationError)
> throw new BadRequestException(err.message)`, or read its `statusHint` (`400`).

**3 — serve it back.** Because you stored the **key** (not a URL), mint a fresh
presigned URL whenever you read the row — nothing leaks or goes stale:

```ts
const files = await this.db.file.findMany({ where: { ownerId } });
return files.map((f) => this.toDto(f)); // each gets a fresh 1-hour URL
```

> **“I just want a URL column.”** Either store `presignGetUrl(...)` with a longer
> `expiresIn` (max **7 days**) and re-mint it periodically, or — for a bucket you
> deliberately make public (an anonymous-GET bucket policy) — store the stable
> path-style URL `` `${PUBLIC_ORIGIN}${mountPath}/${bucket}/${key}` ``. The
> **key + presign-on-read** pattern above is the robust default: no expiry to
> babysit and nothing world-readable by accident.

Notes:

- `FileInterceptor` buffers the file in memory (`file.buffer`), which is fine for
  typical uploads. For large files, `uploadFrom` also accepts a `Readable` (or a
  disk-storage multer file) and streams it straight to disk without buffering —
  only a small header is peeked for sniffing, and the `validate.maxBytes` cap
  aborts an oversize stream mid-write (no partial object is committed).
- `uploadFrom` sniffs the content type from the body's magic bytes and rejects
  mismatched active content (HTML/SVG posing as an image) as defense in depth — it
  complements the locked-down response headers every object read already gets.
- `putObject` remains the low-level primitive if you want no validation/sniffing
  and to pick the key yourself; `uploadFrom` is sugar on top of it.
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

## Server-side encryption (SSE-S3) key model

OpenBucket encrypts objects at rest with a **single, backend-managed 32-byte key**
(the SSE-S3 model). Operational notes:

- **One key for the whole instance.** Every encrypted object of every bucket is
  encrypted with the same key — there is no per-object/per-tenant key derivation
  (that is the SSE-KMS model, out of scope for v1) and **no in-place key rotation**
  in v1 (persisted state is `{ algorithm, iv }` with no key-id, so rotating would
  require re-encrypting every object).
- **Back it up.** Losing the key makes every encrypted object permanently
  unreadable. Store `<dataDir>/sse.key` (or the `OPENBUCKET_SSE_KEY` value) with
  your other break-glass secrets.
- **Deliver it via a secrets manager or file**, not an inline shell env var: prefer
  mounting `sse.key` or injecting `OPENBUCKET_SSE_KEY` from a secrets store so the
  key doesn't leak into process listings, shell history, or logs.
- **Threat-model boundary.** The at-rest design assumes the key material and the
  metadata DB are protected; an attacker who can already read `sse.key` or write the
  DB has defeated the at-rest model regardless. A tampered `obj.encryption` flag does
  not disclose plaintext (the on-disk bytes are ciphertext) and is caught on read by
  the `contentSha256` integrity gate. Known residual gaps: legacy objects without a
  stored `contentSha256`, and range reads above the range-verify cap.

## Caveats

- **Body parsing.** The S3 protocol needs raw, unbuffered request bodies. Do **not**
  apply a global JSON/body parser to `mountPath` in your host app.
- **MikroORM.** OpenBucket runs its own MikroORM (SQLite) instance under an isolated
  context, so it won't collide with a host app's database.
- **Graceful shutdown.** Call `app.enableShutdownHooks()` in your bootstrap so
  OpenBucket's in-flight-drain (`OnApplicationShutdown`) runs on termination.
- **Node** ≥ 20 (libsql native bindings — N-API prebuilds, ABI-stable across Node majors).

## Install-time telemetry (opt out)

`@openbucket/nestjs` pulls in `@nestjs/swagger` for the admin API docs, which in turn
resolves `swagger-ui-dist` → `@scarf/scarf`. Scarf runs a `postinstall` script that
sends anonymous install analytics to `scarf.sh`. OpenBucket ships
`"scarfSettings": { "enabled": false }` in its manifest to disable this best-effort,
but if your CI is privacy-sensitive, suppress the beacon deterministically by exporting
either variable before installing:

```sh
export DO_NOT_TRACK=1          # or: export SCARF_ANALYTICS=false
npm ci
```

Both are honored by scarf-js regardless of dependency-tree resolution. OpenBucket's own
Docker image build and CI already set these.

## License

MIT
