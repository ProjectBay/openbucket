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
upload/download, presigned share links, access-key management, per-bucket
versioning / encryption / object-lock / lifecycle / CORS / policy editors,
i18n (en/de), light/dark themes.

**Operations** — refuse-to-boot env validation, forward-only DB migrations on
startup, graceful drain on `SIGTERM`, structured (pino) JSON logs, health &
readiness probes, request IDs.

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

Full walkthrough (bucket bootstrap, serving, and the “store a URL column”
variants): see the
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
