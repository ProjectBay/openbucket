<div align="center">

# OpenBucket

**A self-hosted, S3-compatible object store you can run as a container — or embed directly into a NestJS app.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/ProjectBay/openbucket/actions/workflows/ci.yml/badge.svg)](https://github.com/ProjectBay/openbucket/actions/workflows/ci.yml)
[![npm: @openbucket/nestjs](https://img.shields.io/npm/v/@openbucket/nestjs.svg)](https://www.npmjs.com/package/@openbucket/nestjs)
[![Built with Nx](https://img.shields.io/badge/built%20with-Nx-143055.svg)](https://nx.dev)

</div>

OpenBucket speaks the **Amazon S3 wire protocol** (SigV4 auth, presigned URLs,
XML error envelopes, multipart uploads, versioning, object lock, lifecycle,
CORS, tagging, bucket policies) over a single Node.js process backed by SQLite +
the local filesystem. It ships with a JSON **admin API** and a polished
**Angular admin console**.

It comes in two shapes from one codebase:

- 🐳 **Standalone** — a small Docker image / Node app. Point any S3 SDK at it.
- 📦 **Embeddable library** — [`@openbucket/nestjs`](./libs/nestjs). Call
  `OpenBucketModule.forRoot({ … })` and mount a complete object store (S3 +
  admin API + admin SPA) under a path prefix inside your own NestJS app.

> **Status:** pre-1.0 and under active development. The S3 surface and admin
> console are feature-complete and tested; APIs may still change before 1.0.

---

## Features

**S3 protocol** — path-style addressing, AWS Signature V4 (header + presigned
query), streaming PUT/GET, multipart uploads, object & bucket tagging, bucket
versioning, **object lock** (governance/compliance retention + legal hold),
**SSE-S3 at-rest encryption** (AES-256), lifecycle expiration, CORS, bucket
policies, and S3-style XML error responses.

**Admin** — a JSON admin API (`/api/admin/*`) secured with argon2id passwords +
rotating JWTs, plus an **Angular admin console**: bucket & object browser,
**cross-bucket object search** (key prefix / substring / tag, keyset-paginated),
upload/download, **inline object preview** (image / PDF / text-code / video / audio,
sandboxed with CSP + per-kind size caps), presigned share links, access-key
management, **multi-admin users with full-admin / read-only roles**, per-bucket
versioning / encryption /
object-lock / lifecycle / CORS / policy editors, a **usage-analytics dashboard**
(storage-over-time, per-bucket size breakdown, request/error charts, live request
rate — from a background rollup with bounded retention), a **persisted audit log**
(every state-changing admin action is queryable in the console, keyset-paged, with
bounded retention), i18n (en/de), light/dark themes.

**Developer file pipeline** — on-the-fly **image transformations** on GET
(`?w=&h=&fit=&format=&q=`, cached derivatives), **object event notifications**
(in-process `@OnObjectCreated()` events for the embedded case + signed HTTP
webhooks), **direct browser uploads** (presigned POST), one-call
`OpenBucketService.uploadFrom()` helpers (content-type sniffing, validation, image
metadata), and a **drop-in multer storage engine** (`@openbucket/nestjs/multer`) —
`FileInterceptor` streams straight into the store (no temp file), with an
`@UploadedToBucket()` decorator and an upload-validation → HTTP 400 filter.

**Durability & replication** — **async one-way replication** to an external
S3-compatible target (AWS S3 / Cloudflare R2 / Backblaze B2 / MinIO) via a durable
**transactional outbox**: every committed PUT/DELETE is mirrored with per-key
ordering, last-writer-wins coalescing, exponential-backoff retry, and a dead-letter
cap; the drain worker resumes on boot and survives remote outages. **Cold-object
tiering** offloads rarely-accessed objects to that same remote (via lifecycle
`<Transition>` rules) and **rehydrates them transparently on read** (single-flight,
integrity-verified, with a presigned redirect for large objects). Plus **backup &
restore** (per-bucket + whole-instance `.zip` snapshots).

**Operations** — refuse-to-boot env validation, forward-only DB migrations on
startup, graceful drain on `SIGTERM`, structured (pino) JSON logs, health &
readiness probes, request IDs, a **Prometheus `/metrics` endpoint** (HTTP
request counter + latency histogram, per-bucket storage/object-count gauges, S3
operation counter, replication-outbox depth — all with bounded label cardinality,
never a raw URL/key/IP; gated `off`/`public`/`token` with a timing-safe bearer
check), **optional OpenTelemetry tracing** (a no-op unless you install
`@opentelemetry/api` + an SDK), and a **dependency-free `openbucket` CLI** (bucket
& key management, backup/restore, replication status) with secret-safe,
scriptable output (`--json`, non-echoing password prompt, redacted errors).

**Embeddable** — runs its ORM under an isolated MikroORM context so it won't
collide with a host app's database, mounts everything under a configurable
`mountPath`, and serves the bundled SPA from the package.

---

## Quick start

### Run with Docker

```bash
# 1. Generate an argon2id hash for your admin password
node scripts/hash-password.mjs 'choose-a-strong-password'

# 2. Copy the env template and fill in the secrets (incl. the hash above)
cp .env.example .env

# 3. Build the image and start it
docker compose up --build
```

OpenBucket is now listening on **http://localhost:9000**:

- **S3 API** — `http://localhost:9000` (path-style)
- **Admin console** — http://localhost:9000/admin
- **Admin API** — `http://localhost:9000/api/admin`
- **Health / readiness** — `/api/admin/health`, `/api/admin/ready`

Talk to it with any S3 client:

```bash
aws --endpoint-url http://localhost:9000 \
    s3 mb s3://my-bucket
aws --endpoint-url http://localhost:9000 \
    s3 cp ./photo.jpg s3://my-bucket/photo.jpg
```

(Configure the AWS CLI/SDK with the `ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`
you set in `.env`, region `us-east-1`, and **path-style** addressing.)

### Embed in a NestJS app

```bash
npm install @openbucket/nestjs
```

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
and the console at `<mountPath>/admin`. Use `forRootAsync({ useFactory, inject })`
to pull secrets from your host's `ConfigService`. See the
[`@openbucket/nestjs` README](./libs/nestjs/README.md) for the full option list.

#### Enable or disable the admin surface

The `admin` block is an on/off switch for the whole admin surface:

- **With `admin`** — the JSON admin API (`<mountPath>/api/admin/*`), the JWT auth
  guard, and (when `serveUi: true`) the Angular console are wired.
- **Without `admin`** — a **headless, S3-only store**: no admin API, no JWT guard,
  no console, no seeded admin user. Just the S3 wire protocol (plus health probes).

```ts
// Headless — S3 only, no admin API or console:
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  mountPath: '/storage',
  rootCredentials: { accessKeyId: process.env.OB_ACCESS_KEY_ID!, secretAccessKey: process.env.OB_SECRET_ACCESS_KEY! },
  // no `admin` key → admin surface is entirely absent
});
```

#### Use it from your code

For **server-side code**, inject `OpenBucketService` — upload, read, list, delete,
manage buckets, and mint presigned URLs in-process, no HTTP round-trip:

```ts
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

  // Direct browser uploads: mint a scoped HTML-form token (presigned POST).
  // The browser appends every `fields` entry + the `file` part LAST, then POSTs
  // to `url` — no S3 SDK in the browser, no bytes through your server.
  uploadForm() {
    return this.ob.createPresignedPost('avatars', {
      key: 'users/${filename}',
      contentLengthRange: { min: 1, max: 5 * 1024 * 1024 },
      contentType: { startsWith: 'image/' },
      successActionStatus: '201',
    }); // → { url, fields }
  }
}
```

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
await s3.send(new PutObjectCommand({ Bucket: 'my-bucket', Key: 'a.jpg', Body: buf }));
```

Full method list and admin-API usage: see the
[`@openbucket/nestjs` README](./libs/nestjs/README.md#using-openbucket-from-your-code).

#### Recipe: file uploads → your database

Take a browser upload, stream it into OpenBucket, and save a row (with a URL) in
your **own** database:

**One line** — swap `FileInterceptor`'s storage for OpenBucket via the
`@openbucket/nestjs/multer` subpath: the file streams straight into the store (no
temp file, no `file.buffer`), and `@UploadedToBucket()` hands you the committed
`{ bucket, key, url, etag, size, contentType }`:

```ts
@Post('files')
@UseFilters(UploadValidationExceptionFilter) // rejected upload → HTTP 400
@UseInterceptors(
  OpenBucketFileInterceptor('file', {
    bucket: 'uploads',
    key: 'uuid',
    validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
  }),
)
upload(@UploadedToBucket() file: UploadedFileInfo) {
  return { key: file.key, url: file.url }; // already committed
}
```

Prefer the lower-level primitive? `putObject` / `uploadFrom` still let you pick the
key and persist it by hand:

```ts
@Post('files')
@UseInterceptors(FileInterceptor('file')) // multer field name: "file"
async upload(@UploadedFile() file: Express.Multer.File) {
  const key = `${randomUUID()}${extname(file.originalname)}`;
  await this.ob.putObject('uploads', key, file.buffer, { contentType: file.mimetype });

  // Store the STABLE key (not a signed URL) in your DB; mint URLs on read.
  await this.db.file.create({ data: { bucket: 'uploads', key, name: file.originalname } });

  return {
    url: this.ob.presignGetUrl('uploads', key, {
      baseUrl: 'https://files.example.com',
      expiresIn: 3600,
    }),
  };
}
```

Full walkthrough (bucket bootstrap, the one-line multer engine + its DI-friendly
mixin, serving, and the “store a URL column” variants): see the
[`@openbucket/nestjs` README](./libs/nestjs/README.md#recipe-accept-file-uploads-and-store-their-urls).

### Run from source

OpenBucket runs on a single Node.js version — **Node 22** (pinned in
[`.nvmrc`](./.nvmrc)). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full setup.

---

## Configuration (standalone)

The standalone app reads its config from the environment and **refuses to boot**
if anything is invalid. See [`.env.example`](./.env.example) for the full,
commented list. The essentials:

| Variable                 | Required | Default      | Notes                                                        |
| ------------------------ | -------- | ------------ | ------------------------------------------------------------ |
| `DATA_DIR`               | ✅       | —            | Directory for the SQLite DB + blob payloads + `sse.key`.     |
| `JWT_SECRET`             | ✅       | —            | ≥ 32 chars; signs admin JWTs.                                |
| `ADMIN_PASSWORD_HASH`    | ✅       | —            | argon2id hash (`node scripts/hash-password.mjs <pw>`).       |
| `ROOT_ACCESS_KEY_ID`     | ✅       | —            | 16–32 uppercase alphanumerics.                               |
| `ROOT_SECRET_ACCESS_KEY` | ✅       | —            | ≥ 32 chars.                                                  |
| `PORT`                   |          | `9000`       | HTTP listen port.                                            |
| `ADMIN_USERNAME`         |          | `admin`      | Admin login.                                                 |
| `OPENBUCKET_REGION`      |          | `us-east-1`  | Region reported to clients.                                  |
| `OPENBUCKET_SSE_KEY`     |          | generated    | base64 of 32 bytes; auto-generated to `<DATA_DIR>/sse.key`.  |
| `KEY_ENCRYPTION_SECRET`  |          | root secret  | ≥ 32 chars; KEK for scoped sub-key secrets at rest. Falls back to `ROOT_SECRET_ACCESS_KEY` when unset (see caveat below). |

### Scoped access keys (multi-tenant)

The root credential is always unrestricted. Mint **scoped sub-keys** —
SigV4-capable keys confined to a bucket/prefix — via
`POST /api/admin/keys` with a `scope`. Scoping is enforced through the same
policy evaluator as bucket policies, with implicit-deny, so a tenant key can't
read outside its prefix, list the whole bucket, or enumerate all buckets. Keys can
be **rotated** (roll the secret, shown once), **revoked** (reversible disable), and
inspected via an **effective-permissions** allow/deny matrix and single-action
**simulate** — all in the admin console and API. See the
[library README](./libs/nestjs/README.md#scoped-access-keys-multi-tenant) for the
scope model, minting recipe, key lifecycle, and the `KEY_ENCRYPTION_SECRET`
rotation caveat.

### Multi-admin users & roles

Beyond the single bootstrap admin, you can manage **multiple admin users** from the
console (**Admin Users**) or the `/api/admin/users` API. Each admin is either a
**full admin** (every action) or **read-only** (can sign in and view everything, but
is `403`'d on any change). Enforcement is server-side and default-deny by HTTP
method, read fresh from the DB on every request, so a demotion takes effect at once.
You can't delete or demote the **last full admin**, and you can't delete your **own**
account. Existing single-admin instances are unaffected — the bootstrap admin is a
full admin. See the
[library README](./libs/nestjs/README.md#admin-roles-multi-admin) for details.

### Async replication

Set `OB_REPLICATION_ENABLED=true` to asynchronously mirror every object
mutation to an external S3-compatible bucket (see the embedded
[library README](./libs/nestjs/README.md#async-replication-to-an-external-s3-target)
for how it works). When enabled, `OB_REPLICATION_BUCKET` and both credentials are
required together (a partial config refuses to boot).

| Variable                                | Required\* | Default       | Notes                                                     |
| --------------------------------------- | ---------- | ------------- | --------------------------------------------------------- |
| `OB_REPLICATION_ENABLED`                |            | `false`       | Master switch. Off ⇒ zero cost, outbox stays empty.       |
| `OB_REPLICATION_ENDPOINT`               |            | —             | S3-compatible endpoint (R2/B2/MinIO). Omit for real AWS S3. `http://` warns (plaintext). |
| `OB_REPLICATION_REGION`                 |            | `us-east-1`   | Target region.                                            |
| `OB_REPLICATION_BUCKET`                 | ✅         | —             | Remote target bucket (must already exist).                |
| `OB_REPLICATION_ACCESS_KEY_ID`          | ✅         | —             | Target credential.                                        |
| `OB_REPLICATION_SECRET_ACCESS_KEY`      | ✅         | —             | Target credential (never logged; redacted).               |
| `OB_REPLICATION_FORCE_PATH_STYLE`       |            | `true`        | `true` for MinIO/S3-compat; `false` for AWS.              |
| `OB_REPLICATION_MAX_ATTEMPTS`           |            | `12`          | Dead-letter cap before an intent → `failed`.              |
| `OB_REPLICATION_DRAIN_INTERVAL_MS`      |            | `5000`        | Background drain tick interval (≥ 1000).                  |
| `OB_REPLICATION_BATCH_KEYS`             |            | `50`          | Distinct keys drained per tick.                           |
| `OB_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES` |      | `67108864`    | Stream via multipart above this (64 MiB).                 |

\* Required only when `OB_REPLICATION_ENABLED=true`.

The admin console's **Replication** page (and the `/api/admin/replication` API)
shows replication health — pending/failed depth and lag — and offers a
**Reconcile** action that scans local objects, diffs them against the target, and
re-enqueues anything missing (a single-flight, bounded backfill). No remote
endpoint or credential is ever surfaced in the status, job errors, or audit log.

### Cold-object tiering (read-through)

Offload **cold objects** to the replication target and **rehydrate them
transparently on read**. Add a `<Transition>` (Days since last access + a
`StorageClass` of `STANDARD_IA`/`GLACIER`/`DEEP_ARCHIVE`) to a bucket's lifecycle
rule; a background sweep tiers matching objects to the remote (after confirming
durability) and a `GET` fetches them back, integrity-verifies, and serves them
identically. Large objects are answered with a short-lived presigned redirect
instead of being proxied. Off by default and a no-op unless a replication target
is also configured — see the
[library README](./libs/nestjs/README.md#cold-object-tiering-read-through).

| Variable | Req | Default | Purpose |
| --------------------------------------------- | :-: | ------------- | ------------------------------------------------------------- |
| `OPENBUCKET_TIER_ENABLED`                     |     | `false`       | Master switch. No-op unless a replication target is configured. |
| `OPENBUCKET_TIER_INLINE_MAX_BYTES`            |     | `268435456`   | Proxy read-through at/under this size; larger ⇒ presigned redirect (256 MiB). |
| `OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS`      |     | `30000`       | Latency bound on a proxied fetch before `503 SlowDown`.       |
| `OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE`    |     | `8`           | Global concurrent-rehydration cap (`0` = unlimited).          |
| `OPENBUCKET_TIER_PRESIGN_TTL_SECONDS`         |     | `300`         | TTL for presigned redirect URLs (30–3600).                    |

---

## Architecture

OpenBucket is a single Node.js process: **NestJS 11** for the HTTP surface,
**MikroORM 6** over **libsql** (SQLite) for metadata, the local filesystem for
blob payloads, and an **Angular 21** ([Spartan UI](https://spartan.ng)) admin
console served as static assets.

The design is documented in depth in the [**whitepaper**](./docs/WHITEPAPER.md):

1. [Backend architecture](./docs/whitepaper/01-backend-architecture.md)
2. [S3 protocol & SigV4](./docs/whitepaper/02-s3-protocol-and-sigv4.md)
3. [Persistence & storage](./docs/whitepaper/03-persistence-and-storage.md)
4. [Streaming & concurrency](./docs/whitepaper/04-streaming-and-concurrency.md)
5. [Admin frontend, auth & delivery](./docs/whitepaper/05-admin-frontend-auth-delivery.md)

### Repository layout

This is an [Nx](https://nx.dev) monorepo.

```
apps/
  openbucket-backend/       Thin deployment shell → bundles the library into the Docker image
  openbucket-backend-e2e/   End-to-end tests against the spawned app
  openbucket-frontend/      Angular admin console (Spartan UI)
  conformance/              S3 protocol conformance suite
libs/
  nestjs/                   @openbucket/nestjs — the publishable, embeddable module (incl. persistence)
  api-client/               Generated TypeScript client for the admin API
docs/                       Whitepaper + project-management corpus
```

---

## Development

OpenBucket runs on a single Node version — **Node 22** (pinned in [`.nvmrc`](./.nvmrc)).

```bash
npm ci

# Backend
nx serve openbucket-backend
nx test  nestjs

# Frontend
nx serve openbucket-frontend
nx build openbucket-frontend

# Lint everything
nx run-many -t lint
```

The publishable-library build and the full contributor workflow are documented
in [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and
our [Code of Conduct](./CODE_OF_CONDUCT.md). Found a security issue? See
[SECURITY.md](./SECURITY.md) — please report it privately.

## License

[MIT](./LICENSE) © OpenBucket contributors.

> OpenBucket is an independent project and is not affiliated with or endorsed by
> Amazon Web Services. "Amazon S3" and "AWS" are trademarks of Amazon.com, Inc.
> "S3-compatible" describes wire-protocol compatibility only.
