---
id: TASK-3620
title: Add prom-client dependency and the shared metrics registry module
story: STORY-1202
status: backlog
type: infra
size: M
---

## Description

Add `prom-client` as a runtime dependency and introduce a `@Global` `MetricsModule`
that owns a single shared `prom-client` `Registry`, registers `collectDefaultMetrics`
exactly once (with an `openbucket_` prefix), and declares every OpenBucket metric
family as injectable providers. This is the foundation every other task in the Story
writes into; on its own it exposes no endpoint and changes no behaviour.

## Files to create / modify

- `libs/nestjs/package.json` — modify (add `"prom-client": "^15.1.3"` to `dependencies`)
- `package.json` (repo root) — modify (add the same `prom-client` version so the workspace installs it)
- `libs/nestjs/src/lib/common/metrics/metrics.module.ts` — new (`@Global` `MetricsModule`)
- `libs/nestjs/src/lib/common/metrics/metrics.registry.ts` — new (`METRICS_REGISTRY` token + `PromMetrics` family holder)
- `libs/nestjs/src/lib/common/common.module.ts` — modify (import/re-export `MetricsModule` so `RequestMetricsInterceptor` can inject the families)
- `libs/nestjs/src/index.ts` — modify (export `METRICS_REGISTRY`, `PromMetrics` types for host apps that want to scrape the registry directly)

## Implementation notes

- Native-dep externalization rule: `apps/openbucket-backend/webpack.config.js` derives
  its `externalDependencies` from `Object.keys(require('./package.json').dependencies)`
  routed through `libs/nestjs/package.json`. Because `prom-client` is added to the lib's
  `dependencies`, it is externalized automatically and lands in the `generatePackageJson`
  dist manifest — no webpack edit is needed, but the root `package.json` MUST also carry
  it so `nx` install resolves it (the two-manifest declaration + auto-externalization is
  the "3-place" rule).
- `metrics.registry.ts` exports the DI token and constructs the families ONCE:

  ```ts
  export const METRICS_REGISTRY = Symbol('openbucket:metrics-registry');

  export interface PromMetrics {
    readonly registry: Registry;
    readonly httpRequestsTotal: Counter<'surface' | 'method' | 'route_class' | 'status_class'>;
    readonly httpRequestDurationSeconds: Histogram<'surface' | 'method' | 'route_class' | 'status_class'>;
    readonly s3OperationsTotal: Counter<'operation'>;
    readonly storageBytes: Gauge<'bucket'>;
    readonly objectCount: Gauge<'bucket'>;
    readonly replicationOutboxDepth: Gauge<'status'>;
  }

  export function buildPromMetrics(): PromMetrics {
    const registry = new Registry();
    collectDefaultMetrics({ register: registry, prefix: 'openbucket_' });
    // …new Counter/Histogram/Gauge({ name, help, labelNames, registers: [registry] })
  }
  ```

- Histogram buckets: use seconds with S3-appropriate boundaries, e.g.
  `buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` (covers small
  admin JSON calls up to large multipart PUTs). Constant, not configurable.
- Provide the families as a value provider (`useFactory: buildPromMetrics`) under a
  `PROM_METRICS` token, exported so `RequestMetricsInterceptor` (TASK-3621) and the
  rollup runner (TASK-3622) inject the SAME instances.
- `@Global` + single-factory construction guarantees `collectDefaultMetrics` runs once;
  guard against double-registration in tests by calling `registry.clear()` is NOT needed
  because each module instance builds its own `Registry` (never the global default
  `client.register`), which also keeps the standalone app and an embedded host isolated.
- Security/DoS: never register a metric with an unbounded label (bucket label is bounded
  by the number of live buckets; see TASK-3622 for gauge eviction). No secret is ever a
  label or a metric name.
- Edge case: two OpenBucket instances in one Node process (multi-tenant host) — because
  the registry is per-module-instance and never the process-global `client.register`, the
  two do not collide.

## Acceptance criteria

- [ ] `prom-client` appears in `libs/nestjs/package.json` and root `package.json` dependencies, and `nx build openbucket-backend` externalizes it (it appears in the emitted dist `package.json`, not inlined in `main.js`).
- [ ] `MetricsModule` is `@Global`, provides `PROM_METRICS`/`METRICS_REGISTRY`, and boots without a "metric already registered" error even when the module graph is instantiated twice in one process (unit test).
- [ ] `nx build nestjs` and `nx lint nestjs` pass.
- [ ] Scraping `registry.metrics()` returns default process metrics prefixed `openbucket_` (e.g. `openbucket_process_cpu_seconds_total`).

## Test obligations

- Unit: covered by [TEST-1202] (registry construction, single default-metrics registration, no cross-instance collision)
- E2E: covered by [TEST-1202] (process metrics present in the scrape body)
- Conformance: N/A — pure infra

## Dependencies

- Blocked by: none
</content>
