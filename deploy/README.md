# Deploy templates

One-click / one-file deployment templates for the standalone OpenBucket image
(`ghcr.io/projectbay/openbucket`). Each provisions a persistent volume at `/data`,
exposes the S3 API + admin console on port **9000**, and auto-generates the random
secrets where the platform can.

| Platform | Template | How to use |
| --- | --- | --- |
| **CapRover** | [`caprover/openbucket.yml`](./caprover/openbucket.yml) | Dashboard → **One-Click Apps** → paste the file's raw URL (or the YAML). |
| **Coolify** | [`coolify/docker-compose.yaml`](./coolify/docker-compose.yaml) | **New Resource → Docker Compose** → paste the file; assign a domain. |
| **Render** | [`render/render.yaml`](./render/render.yaml) | Commit as `render.yaml` and create a **Blueprint**, or use it as a reference. |
| **Fly.io** | [`fly/fly.toml`](./fly/fly.toml) | `fly launch --copy-config --no-deploy`, set secrets, `fly deploy`. |

## The one manual step: the admin password hash

OpenBucket stores an **argon2id hash** of the admin password, never the password
itself — so no platform can auto-generate it. Every template above generates the
`JWT_SECRET` and `ROOT_SECRET_ACCESS_KEY` for you, but you supply
`ADMIN_PASSWORD_HASH`. Generate one on any machine with Node (no repo checkout):

```bash
npx @openbucket/nestjs hash 'your-admin-password'
# → $argon2id$v=19$m=65536,t=3,p=4$...   ← paste this into the template's hash field
```

The `ROOT_ACCESS_KEY_ID` defaults to a non-secret placeholder
(`AKIAOPENBUCKETROOT01`, like an AWS access key ID) — override it if you like. The
generated `ROOT_SECRET_ACCESS_KEY` is what you keep secret; copy it from the
platform's env/config after deploy to point your S3 client at the instance
(path-style, `forcePathStyle: true`).

See the [deployment guide](https://projectbay.github.io/openbucket/docs/operations/one-click-deploy)
for step-by-step instructions per platform.
