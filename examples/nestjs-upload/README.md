# Example: embed OpenBucket in a NestJS app

A minimal, complete NestJS app that runs the [`@openbucket/nestjs`](https://www.npmjs.com/package/@openbucket/nestjs)
S3-compatible object store **in-process** — no second service, no container, no
cloud account. It exposes a `POST /files` upload endpoint and a `GET /files/<key>`
read endpoint, and serves the bundled admin console.

## What it shows

- Registering the store with `OpenBucketModule.forRoot({...})`, reading secrets from env.
- Creating the `uploads` bucket on boot with a small `OnModuleInit` provider.
- A one-line upload endpoint using `OpenBucketFileInterceptor` + `@UploadedToBucket()`
  (streams straight into the store — no temp file), with content sniffing + a size cap.
- Reading an object back via `OpenBucketService.getObjectBuffer` (with a `presignGetUrl`
  alternative shown in a comment).

## Prerequisites

- Node.js 22+
- `openssl` (to generate random secrets)

## Run it

```bash
# 1. Install dependencies
npm install

# 2. Create your env file and fill in the secrets
cp .env.example .env

# 3. Generate the admin password hash (argon2id) and drop it into OB_ADMIN_HASH
npx @openbucket/nestjs hash 'choose-a-strong-password'

# 4. Generate two random 32-char secrets for OB_JWT_SECRET and OB_SECRET_ACCESS_KEY
openssl rand -hex 32
openssl rand -hex 32

# 5. Start the app (loads .env, watches for changes)
npm start
```

The app listens on **http://localhost:3000**.

## Try it

```bash
# Upload an image (only image/* is allowed, capped at 10 MiB):
curl -F 'file=@photo.jpg' http://localhost:3000/files
# → { "key": "<uuid>.jpg", "contentType": "image/jpeg", "size": 12345,
#     "readPath": "/files/<uuid>.jpg" }

# Read it back (streams the bytes):
curl http://localhost:3000/files/<uuid>.jpg --output roundtrip.jpg
```

A non-image, or anything over 10 MiB, comes back as a structured `400` — no bytes stored.

## Admin console

Open **http://localhost:3000/storage/admin** and sign in with `admin` and the
password you hashed in step 3. You'll see the uploaded object in the bucket browser,
with an inline preview. (The whole store — S3 endpoint + admin — mounts under the
`mountPath` set in `src/app.module.ts`, here `/storage`.)

## Files

| File | Purpose |
| --- | --- |
| `src/main.ts` | Nest bootstrap. |
| `src/app.module.ts` | Registers `OpenBucketModule.forRoot(...)` from env. |
| `src/app.bootstrap.ts` | Creates the `uploads` bucket on `OnModuleInit`. |
| `src/files.controller.ts` | `POST /files` upload + `GET /files/<key>` read. |
| `.env.example` | The required secrets, with generation instructions. |

## Type-check

```bash
npm run build       # tsc -p tsconfig.json
# or, no emit:
npm run typecheck
```

## Learn more

Full guides and API reference: <https://projectbay.github.io/openbucket/> (see the
[file uploads guide](https://projectbay.github.io/openbucket/docs/guides/file-uploads)).
