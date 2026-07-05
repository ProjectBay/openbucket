---
title: Monitoring
description: Watch a running OpenBucket — liveness/readiness probes, the Prometheus /metrics endpoint, structured pino logs with request IDs, and the persisted audit log.
sidebar_position: 2
---

# Monitoring

**What you'll do:** know at a glance whether OpenBucket is healthy, scrape its
metrics into Prometheus, follow structured logs by request ID, and audit who
changed what.

## Health and readiness probes

Two **unauthenticated** probes, safe for orchestrators to poll:

```bash
curl -s http://localhost:9000/api/admin/health   # {"status":"ok","uptime":1234}
curl -s http://localhost:9000/api/admin/ready     # {"status":"ready"}  (503 while draining)
```

- `GET /api/admin/health` — **liveness**: the process is up and the event loop
  responds. Use it for a container/liveness probe and to gate a load balancer.
- `GET /api/admin/ready` — **readiness**: returns `200 {"status":"ready"}`
  normally, and `503 {"status":"draining"}` once a `SIGTERM` starts the graceful
  shutdown — so a rolling update pulls the pod before it stops accepting work.

(Under an embedded `mountPath`, these live at `<mountPath>/api/admin/health` and
`/ready`.) See [Deployment](./deployment.md#health-checks) for probe wiring.

## Prometheus metrics

A Prometheus scrape endpoint is served at **`/metrics`** (text exposition format
`0.0.4`). It is **off by default** — turn it on and pick an access mode:

```bash
METRICS_MODE=token          # 'off' (default) | 'public' | 'token'
METRICS_TOKEN=<a-strong-random-token>   # required + validated strong when MODE=token
```

- **`off`** — the route isn't served; no registry body is ever leaked.
- **`public`** — an unauthenticated scrape (for a trusted network / internal Prometheus).
- **`token`** — requires `Authorization: Bearer <token>`, compared in **constant
  time**; a weak or empty token in `token` mode **refuses to boot**.

Scrape it:

```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:9000/metrics
```

Exported families (all with **bounded** label cardinality — never a raw URL,
object key, or client IP):

| Metric | Type | Labels |
| --- | --- | --- |
| `openbucket_http_requests_total` | counter | `surface`, `method`, `route_class`, `status_class` |
| `openbucket_http_request_duration_seconds` | histogram | same as above |
| `openbucket_s3_operations_total` | counter | `operation` |
| `openbucket_storage_bytes` | gauge | `bucket` |
| `openbucket_object_count` | gauge | `bucket` |
| `openbucket_replication_outbox_depth` | gauge | `status` (`pending`/`inflight`/`failed`) |
| `openbucket_integrity_objects` | gauge | `status` (`ok`/`corrupt`/`unchecked`) |
| `openbucket_integrity_last_run_timestamp` | gauge | — |
| `openbucket_process_*` / `openbucket_nodejs_*` | default | — |

:::note[What updates when]
HTTP counters and the latency histogram are recorded live by the request
interceptor. The per-bucket gauges are refreshed on the **usage-rollup** tick
(`USAGE_ROLLUP_INTERVAL_MS`, default 15 min) from an in-memory aggregate — so a
scrape never runs a database query — and a deleted bucket's series is evicted on
the next tick. The integrity gauges appear only when the scrubber is enabled.
:::

Good alerts to start with: `openbucket_replication_outbox_depth{status="failed"}`
climbing, `openbucket_integrity_objects{status="corrupt"}` above zero, and the
`0.99` quantile of the request-duration histogram.

## Structured logs and request IDs

OpenBucket logs **structured JSON via pino** to stdout (Docker captures it; in
`NODE_ENV=development` it pretty-prints). Set the level with `LOG_LEVEL`
(`trace`…`fatal`, default `info`).

Every request gets a **request ID** (a UUID v7, or the incoming `X-Request-Id` if
you pass one), echoed back on **two** response headers so you can correlate a
client error with a server log line:

```text
X-Request-Id: 018f...      the canonical id, also on every log line for the request
X-Amz-Request-Id: 018f...  the same id, so S3 SDKs surface it in their error messages
```

Logs are **redacted by design**: secret-looking fields (`password`, `secret`,
`secretAccessKey`, `token`, `authorization`, `KEY_ENCRYPTION_SECRET`, …) are
censored, and SigV4 query-auth parameters are stripped from logged URLs so a
presigned request never logs a replayable signature.

## The audit log

Every **state-changing** admin action is emitted as a pino record (`audit: true`)
**and** persisted to an `audit_logs` table, so you can browse history the log
stream has rotated away. The admin console's **Audit log** page reads it, backed
by two JWT-guarded, read-only endpoints:

| Endpoint | Returns |
| --- | --- |
| `GET /api/admin/audit?event=&subject=&bucket=&from=&to=&cursor=&limit=` | A newest-first, keyset-paged `{ items, nextCursor }` (`limit ≤ 200`). |
| `GET /api/admin/audit/catalog` | The static event-name list for the filter dropdown. |

Writes never block the request handler: `emit` pushes onto a bounded in-memory
ring buffer, and a background flush tick (`AUDIT_FLUSH_MS`, default 2 s)
batch-inserts drained rows and prunes anything older than `AUDIT_RETENTION_DAYS`
(default 90). Secret-looking fields are stripped before a row is stored, and
read-only `GET`s are **not** audited.

## Tracing (optional)

Set `OTEL_TRACING_ENABLED=true` to wrap each request in an OpenTelemetry span
(named by `surface`/`route_class`, only bounded attributes). It's a genuine
**no-op** unless you install `@opentelemetry/api` **and** register an SDK — the
library never hard-depends on any `@opentelemetry/*` package.

## Next steps

- [Observability guide](../guides/observability.md) — a full walkthrough of metrics, dashboards, and alerts.
- [Deployment](./deployment.md) — health-probe wiring and the reverse proxy.
- [Durability](../concepts/durability.md) — what the replication and integrity metrics mean.
- [Upgrading](./upgrading.md) — what to watch during and after an upgrade.
