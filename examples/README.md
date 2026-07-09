# OpenBucket examples

Runnable, cloneable examples for the two ways to use OpenBucket. Each folder is
self-contained — copy it out of the repo, follow its README, and you have a
working setup.

| Example | What it is | Run it with |
| --- | --- | --- |
| [`nestjs-upload/`](./nestjs-upload) | Embed the object store **in-process** in a NestJS app: a `POST /files` upload endpoint (streamed, validated) + a `GET /files/<key>` read, plus the bundled admin console. | `npm install` &rarr; `npm start` |
| [`docker-standalone/`](./docker-standalone) | Run the **published** OpenBucket image as a standalone S3-compatible service, then upload with the AWS CLI. | `docker compose up -d` &rarr; `./upload.sh` |

Both need a few secrets (an argon2id admin-password hash + two random 32-char
strings) — each README walks through generating them with
`npx @openbucket/nestjs hash` and `openssl rand -hex 32`.

## Learn more

- Docs & guides: <https://projectbay.github.io/openbucket/>
- npm package: <https://www.npmjs.com/package/@openbucket/nestjs>
