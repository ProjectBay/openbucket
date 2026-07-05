---
title: Admin API
description: The JSON admin API under mountPath/api/admin — the JWT auth flow, the typed api-client, and every endpoint group.
sidebar_position: 5
---

# Admin API

Everything the admin console does, it does over a JSON HTTP API under
`<mountPath>/api/admin`. It's secured with argon2id passwords and rotating JWTs.
In the standalone app `mountPath` is empty, so the base path is
`http://localhost:9000/api/admin`; embedded, it's `<mountPath>/api/admin`.

Log in, then call an endpoint with the bearer token:

```bash
# 1. Log in — returns an access token (a refresh token is set as an HttpOnly cookie).
curl -X POST http://localhost:9000/api/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"your-admin-password"}'
# → { "accessToken": "eyJ…", "expiresIn": 900 }

# 2. Use the access token as a bearer on every other call.
curl http://localhost:9000/api/admin/buckets \
  -H 'authorization: Bearer eyJ…'
```

## Auth flow

| Endpoint | Method | What it does |
| --- | --- | --- |
| `/api/admin/auth/login` | `POST` | Exchange `{ username, password }` for `{ accessToken, expiresIn }`. Sets the rotating refresh token as an HttpOnly, `Secure`, `SameSite=Strict` cookie (`ob_refresh`). Rate-limited to 5/min. |
| `/api/admin/auth/refresh` | `POST` | Rotate the refresh cookie for a fresh `{ accessToken, expiresIn }`. Rejects revoked/expired/reused tokens. |
| `/api/admin/auth/logout` | `POST` | Revoke the refresh token and clear the cookie (`204`). |
| `/api/admin/auth/me` | `GET` | The current identity from the token claims: `{ id, username, mustChangePassword, role }`. |

Access tokens are short-lived (default 900 s); refresh tokens live in the
`ob_refresh` cookie (default 7 days). Send the access token as
`Authorization: Bearer <token>` on every non-public call.

:::info[Typed client & OpenAPI]
The backend exports an OpenAPI document, and [`@openbucket/api-client`](https://github.com/ProjectBay/openbucket/tree/main/libs/api-client)
is generated from it (openapi-generator, `typescript-angular`) — one typed service
per endpoint group. The admin console consumes it directly. Regenerate with
`nx run api-client:generate`; never hand-edit the generated `lib`.
:::

## Endpoint groups

| Group | Base path | Purpose |
| --- | --- | --- |
| **Auth** | `/api/admin/auth` | Login, refresh, logout, `me` (above). |
| **Buckets** | `/api/admin/buckets` | List/create/get/delete buckets, plus per-bucket versioning, tagging, encryption, lifecycle, CORS, object-lock, and policy editors. |
| **Objects** | `/api/admin/buckets/:name/objects` | Browse, batch-delete, list versions, object tagging / retention / legal-hold, presign, and raw `GET`/`PUT`/`DELETE` by key. Plus `/api/admin/objects/search` for cross-bucket search. |
| **Keys** | `/api/admin/keys` | Create, list, update, rotate, and revoke access keys; inspect effective-permissions and simulate a single action. |
| **Users** | `/api/admin/users` | Manage multiple admin users (full-admin / read-only roles). |
| **Backup** | `/api/admin` + `/api/admin/backup/schedule` | Download / restore whole-instance and per-bucket `.zip` snapshots; view and trigger the backup schedule. |
| **Replication** | `/api/admin/replication` | Replication `status`, trigger a `reconcile`, and poll a reconcile job. |
| **Integrity** | `/api/admin/integrity` | Scan `status`, the `corrupt`-object list, and a manual `scrub` trigger. |
| **Audit** | `/api/admin/audit` | Query the persisted, keyset-paged audit log and its event `catalog`. |
| **Analytics** | `/api/admin/analytics` | Usage dashboard data: `storage` over time, per-`buckets` breakdown, and `requests`/error rates. |
| **Settings** | `/api/admin/settings` | Admin self-service, e.g. `change-password`. |
| **Version / health** | `/api/admin` | `version`, plus the public `health` and `ready` probes. |
| **Metrics** | `/metrics` | Prometheus scrape — mounted at `<mountPath>/metrics`, gated by `METRICS_MODE` (not under `/api/admin`). |

## Roles & rate limiting

- **Roles.** Every admin is either a **full admin** (all actions) or **read-only**
  (can sign in and read everything, but is `403`'d on any state-changing method).
  Enforcement is server-side and read fresh from the DB on every request, so a
  demotion takes effect immediately. You can't delete or demote the last full
  admin, nor delete your own account.
- **Rate limiting.** The admin plane is throttled (login is 5/min). A `429`
  carries `Retry-After`; clients should not hammer-retry.

:::note[Errors]
Errors use a JSON envelope (`{ error, message, statusCode }`) with S3-style HTTP
codes — `401` (unauthenticated), `403` (read-only or forbidden), `404`,
`409` (e.g. `BucketNotEmpty`), `429` (rate limited).
:::

## Next steps

- [CLI reference](./cli-reference.md) — the `openbucket` CLI wraps this API.
- [Configuration](./configuration.md) — JWT TTLs, metrics gating, and admin roles.
- [S3 compatibility](./s3-compatibility.md) — the data plane alongside this control plane.
- [NestJS module reference](./nestjs-module.md) — enable or disable the admin surface.
