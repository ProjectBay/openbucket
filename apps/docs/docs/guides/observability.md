---
title: Observability (metrics & tracing)
description: Scrape OpenBucket with Prometheus, chart it in Grafana, and add OpenTelemetry tracing.
sidebar_position: 9
---

# Observability

Turn on the Prometheus `/metrics` endpoint, point Prometheus at it, and chart request rate, latency, storage, and replication backlog in Grafana — then optionally light up OpenTelemetry traces.

## Turn it on (30 seconds)

Metrics are **off by default**. Flip the mode to `public` and you have a scrape target.

**Standalone** — set an environment variable:

```bash
METRICS_MODE=public
```

**Embedded** (`@openbucket/nestjs`) — pass a `metrics` block:

```ts
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  mountPath: '/storage',
  // ...rootCredentials, admin...
  metrics: { mode: 'public' },
});
```

Now scrape it:

```bash
# Standalone (mountPath is the root, port 9000):
curl http://localhost:9000/metrics

# Embedded under mountPath "/storage":
curl http://localhost:3000/storage/metrics
```

You get standard Prometheus text exposition (`Content-Type: text/plain; version=0.0.4`) with every `openbucket_*` family below.

:::note Where the endpoint lives
The route is always `<mountPath>/metrics`. Standalone mounts at the root, so it is `/metrics`. Embedded, it sits under your `mountPath` (default `/storage`) — e.g. `/storage/metrics`.
:::

## The three guard modes

`METRICS_MODE` (env) / `metrics.mode` (option) takes one of three values:

| Mode | Behavior |
| --- | --- |
| `off` (default) | The endpoint returns **404** — indistinguishable from an unmapped route, so no registry body ever leaks. |
| `public` | Unauthenticated scrape. The right choice for a trusted network or an internal Prometheus that can reach the pod but the public internet can't. |
| `token` | Requires `Authorization: Bearer <token>` and compares it in **constant time**. Any miss returns **401**. |

For `token` mode you must also supply a **strong** token — it is validated at boot, so a weak token refuses to start rather than silently exposing metrics:

```bash
METRICS_MODE=token
METRICS_TOKEN=a-long-random-secret-at-least-32-chars
```

```ts
metrics: { mode: 'token', token: process.env.METRICS_TOKEN! }
```

Then scrape with the bearer header:

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:9000/metrics
```

:::tip The token is never logged
The bearer header is redacted by the same pino redaction path as every other credential — it never lands in a log line, an error message, or a span attribute.
:::

## What's exported

Every metric carries an `openbucket_` prefix. Label cardinality is **deliberately bounded** (CWE-770): the HTTP families use only coarse, finite dimensions — never a raw URL, object key, client IP, or signature.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `openbucket_http_requests_total` | counter | `surface`, `method`, `route_class`, `status_class` | Total HTTP requests handled. |
| `openbucket_http_request_duration_seconds` | histogram | `surface`, `method`, `route_class`, `status_class` | Request latency in seconds. |
| `openbucket_s3_operations_total` | counter | `operation` | S3 operations by resolved name (`PutObject`, `GetObject`, …). |
| `openbucket_storage_bytes` | gauge | `bucket` | Stored bytes per bucket (refreshed on the usage-rollup tick). |
| `openbucket_object_count` | gauge | `bucket` | Live object count per bucket. |
| `openbucket_replication_outbox_depth` | gauge | `status` | Replication outbox depth by `pending` / `inflight` / `failed`. |
| `openbucket_integrity_objects` | gauge | `status` | Object count by integrity `status` (`ok` / `corrupt` / `unchecked`). |
| `openbucket_integrity_last_run_timestamp` | gauge | — | Unix seconds of the last integrity scrub that did work (`0` if never). |

Plus the standard Node process metrics (`openbucket_process_cpu_*`, `openbucket_nodejs_*`, …) — namespaced with the same prefix so two OpenBucket module graphs in one process never collide.

The bounded label **values** are:

- `surface` — `admin` or `s3`.
- `route_class` — `admin`, `s3-service`, `s3-bucket`, `s3-object`, or `s3`.
- `status_class` — `1xx`, `2xx`, `3xx`, `4xx`, or `5xx`.

The only labels that carry a bucket name are the two per-bucket gauges, and they're bounded by the number of live buckets (stale series are evicted on the rollup tick).

## Prometheus scrape config

Drop this into your `prometheus.yml`. For `public` mode:

```yaml
scrape_configs:
  - job_name: openbucket
    metrics_path: /metrics          # or /storage/metrics when embedded
    static_configs:
      - targets: ['openbucket:9000']
```

For `token` mode, add the bearer token:

```yaml
scrape_configs:
  - job_name: openbucket
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: 'a-long-random-secret-at-least-32-chars'
    static_configs:
      - targets: ['openbucket:9000']
```

:::warning Rate limits apply
The scrape is subject to the admin throttler (100 requests/min). A 15–30s scrape interval is plenty and stays well under the bound.
:::

## Grafana panels

A few queries to get you started. Each is a single PromQL expression you can paste into a Grafana panel.

**Request rate by route class** (Time series):

```text
sum(rate(openbucket_http_requests_total[5m])) by (route_class)
```

**5xx error ratio** (Stat / gauge):

```text
sum(rate(openbucket_http_requests_total{status_class="5xx"}[5m]))
  / sum(rate(openbucket_http_requests_total[5m]))
```

**p95 request latency** (Time series) — the histogram exposes `_bucket` series, so use `histogram_quantile`:

```text
histogram_quantile(0.95,
  sum(rate(openbucket_http_request_duration_seconds_bucket[5m])) by (le))
```

**Stored bytes per bucket** (Bar gauge):

```text
openbucket_storage_bytes
```

**Replication backlog** (Stat) — a rising `failed` count is your alert signal:

```text
openbucket_replication_outbox_depth{status="failed"}
```

**Corrupt objects** (Stat):

```text
openbucket_integrity_objects{status="corrupt"}
```

## OpenTelemetry tracing

Tracing is an **optional peer**: OpenBucket never hard-depends on any `@opentelemetry/*` package. It's a genuine no-op unless you both enable it **and** install the api.

**Step 1 — enable it.**

```bash
OTEL_TRACING_ENABLED=true
```

```ts
tracing: { enabled: true }
```

**Step 2 — install `@opentelemetry/api` plus an SDK.** Without the api, OpenBucket logs a single boot warning and stays a no-op (tracing is non-critical telemetry, so it never blocks boot):

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

Even with the api installed, spans do nothing until an SDK registers a global tracer provider — that's the api package's own default no-op tracer, which satisfies the "no-op unless an SDK is present" contract for free.

OpenBucket wraps request handling in a span named against the `openbucket` tracer. Span attributes hold to the **same redaction posture as logs**: only bounded, non-sensitive dimensions (`method`, `route_class`, `surface`) and the final `http.status_code` — never the URL, object key, bucket, or any header or credential.

:::info Why the eval require
The library resolves `@opentelemetry/api` dynamically at runtime so neither `tsc` nor a host webpack bundle needs the (possibly absent) package. Hosts that never opt in pay nothing and the bundle builds and boots without OTel installed.
:::

## Next steps

- [CLI](./cli.md) — check replication backlog and buckets from the terminal.
- [Admin console](./admin-console.md) — the Integrity page mirrors `openbucket_integrity_objects` with a live scrub trigger.
- [NestJS module reference](../reference/nestjs-module.md) — every `forRoot` option, including `metrics` and `tracing`.
