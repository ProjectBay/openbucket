# openbucket-docs-analytics

A tiny **cookieless, first-party** pageview collector for the OpenBucket
documentation site — **no third-party services**. The docs site (Docusaurus on
GitHub Pages) sends an anonymous beacon on each page view to a collector **you**
run on your own VPS; it stores aggregate counts in SQLite and serves a small
stats dashboard.

- **No cookies, no `localStorage`, no fingerprinting, no PII at rest.** The client
  IP + User-Agent are combined with a **per-day rotating salt** and SHA-256 hashed
  into a visitor id used only for daily de-duplication. The raw IP is never stored,
  and the daily salt rotation means visitors can't be correlated across days.
- Respects `navigator.doNotTrack`.
- Footprint: one small Node process + a SQLite file. No Postgres, no ClickHouse.

## Endpoints

| Method | Path          | Purpose                                              |
| ------ | ------------- | ---------------------------------------------------- |
| `POST` | `/collect`    | Ingest a beacon (called by the docs site).           |
| `GET`  | `/stats`      | HTML dashboard (bearer token).                       |
| `GET`  | `/stats.json` | Same data as JSON (bearer token).                    |
| `GET`  | `/health`     | Liveness probe → `ok`.                               |

`/stats` accepts the token as `Authorization: Bearer <token>` **or** `?token=<token>`
(handy for viewing in a browser).

## Configuration

See [`.env.example`](./.env.example). The essentials:

| Variable         | Default                        | Notes                                             |
| ---------------- | ------------------------------ | ------------------------------------------------- |
| `PORT`           | `8787`                         | HTTP listen port.                                 |
| `DB_PATH`        | `./analytics.db`               | SQLite file (persist on a volume).                |
| `ALLOWED_ORIGIN` | `*`                            | Docs origin allowed to POST; set to lock it down. |
| `STATS_TOKEN`    | —                              | **Required** to view `/stats`. Generate a random one. |
| `RETENTION_DAYS` | `365`                          | Raw events older than this are pruned nightly.    |
| `TRUST_PROXY`    | `true`                         | Use `X-Forwarded-For` (behind nginx/Caddy).       |

## Run it (on your VPS)

```bash
# 1. A token to protect the stats page:
export STATS_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")

# 2. Start it (binds to 127.0.0.1:8787):
docker compose up --build -d
```

Put it behind your existing TLS reverse proxy, e.g. nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Then it's reachable at `https://analytics.example.com`, and the stats page at
`https://analytics.example.com/stats?token=$STATS_TOKEN`.

## Point the docs at it

The Docusaurus beacon is already wired (see `apps/docs`). It only activates when
the docs are **built with** `DOCS_ANALYTICS_URL` set to your collector's
`/collect` endpoint:

```bash
DOCS_ANALYTICS_URL=https://analytics.example.com/collect npm run build   # in apps/docs
```

(The GitHub Pages deploy workflow sets this from a repository variable; without it
the beacon is a no-op, so local dev and PR builds never phone home.)

## Local development

```bash
npm install
STATS_TOKEN=dev npm run dev      # http://localhost:8787
# send a test beacon:
curl -XPOST localhost:8787/collect -d '{"path":"/docs/intro","referrer":"https://news.example/"}'
open http://localhost:8787/stats?token=dev
```
