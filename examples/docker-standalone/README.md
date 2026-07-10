# Example: run the standalone OpenBucket image

Run OpenBucket as a single, self-contained container using the **published**
image — an S3-compatible object store plus a bundled admin console on one port,
no build step. Point any S3 client (AWS CLI, SDKs) at `http://localhost:9000`.

## What it shows

- A `docker-compose.yml` using the published image
  `ghcr.io/projectbay/openbucket:0.1.0-alpha.20` with a named data volume and a healthcheck.
- Generating the required secrets and passing them via `env_file`.
- Creating a bucket and uploading a file with the AWS CLI (path-style).

## Prerequisites

- Docker (with `docker compose`)
- The AWS CLI (for `upload.sh`)
- `openssl` (to generate random secrets)

## Run it

```bash
# 1. Create your env file
cp .env.example .env

# 2. Generate the admin password hash (argon2id) → ADMIN_PASSWORD_HASH
npx @openbucket/nestjs hash 'your-admin-password'

# 3. Generate two random 32-char secrets → JWT_SECRET and ROOT_SECRET_ACCESS_KEY
openssl rand -hex 32
openssl rand -hex 32

# 4. Start it (detached)
docker compose up -d
```

The container refuses to boot if any secret is missing or malformed — check
`docker compose logs -f openbucket` if it restarts.

## Upload a file

```bash
./upload.sh                       # creates bucket "demo", uploads a sample file
./upload.sh ./photo.jpg photos    # or: FILE BUCKET
```

`upload.sh` reads the root credentials from your `.env`, then uses the AWS CLI
(path-style, `--endpoint-url http://localhost:9000`) to `mb` the bucket and `cp`
the file. A `curl` equivalent is shown in a comment at the bottom of the script.

## Admin console

Open **http://localhost:9000/admin** and sign in with `admin` and the password
you hashed in step 2. Your uploaded object shows up in the bucket browser.

## Tear down

```bash
docker compose down          # stop (keeps the data volume)
docker compose down -v       # stop and delete all stored data
```

## Learn more

Full docs: <https://projectbay.github.io/openbucket/>
