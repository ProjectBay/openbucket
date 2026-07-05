---
id: TASK-3624
title: Add optional no-op OpenTelemetry tracing hooks
story: STORY-1202
status: backlog
type: implementation
size: M
---

## Description

Add a thin OpenTelemetry tracing seam that wraps request handling in a span, but is
a genuine no-op unless an OTel SDK is registered in the host process. The library must
NOT hard-depend on any `@opentelemetry/*` package: it resolves `@opentelemetry/api`
dynamically and falls back to a no-op tracer when absent, so hosts that never opt in
pay nothing and the bundle builds without OTel installed.

## Files to create / modify

- `libs/nestjs/src/lib/common/tracing/tracing.service.ts` — new (`TracingService`: dynamic `@opentelemetry/api` resolution + no-op fallback, `startActiveSpan` helper)
- `libs/nestjs/src/lib/common/tracing/tracing.module.ts` — new (`@Global` `TracingModule`, provides `TracingService`)
- `libs/nestjs/src/lib/common/interceptors/request-metrics.interceptor.ts` — modify (optionally wrap `next.handle()` in a span when tracing is enabled)
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (`OTEL_TRACING_ENABLED: z.coerce.boolean().default(false)`)
- `libs/nestjs/src/lib/common/config/config-source.ts` — modify (map `opts.tracing?.enabled` → `OTEL_TRACING_ENABLED`)
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify (`tracingEnabled` getter)
- `libs/nestjs/src/lib/open-bucket-options.ts` — modify (`tracing?: { enabled?: boolean }` in options + resolved shape + `resolveOptions` default `false`)
- `libs/nestjs/package.json` — modify (add `@opentelemetry/api` to `peerDependencies` with `peerDependenciesMeta.@opentelemetry/api.optional = true`)

## Implementation notes

- `@opentelemetry/api` is designed exactly for this: `trace.getTracer(...)` returns a
  no-op tracer until an SDK calls `trace.setGlobalTracerProvider(...)`. So the "no-op
  unless SDK present" requirement is satisfied by the api package's own default — we only
  need to (a) not hard-require it, (b) gate on config.
- Resolution + fallback (never import statically — a static `import` would make webpack
  try to bundle/externalize a package that may be absent):

  ```ts
  type ApiModule = typeof import('@opentelemetry/api');
  function loadOtelApi(): ApiModule | null {
    try { return require('@opentelemetry/api') as ApiModule; }
    catch { return null; }   // package not installed → tracing is a hard no-op
  }
  ```

  In `TracingService.onModuleInit`, if `AppConfigService.tracingEnabled` is `true`, call
  `loadOtelApi()`; store the tracer (`api.trace.getTracer('openbucket', OPENBUCKET_VERSION)`)
  or leave it `null`. Expose:

  ```ts
  startActiveSpan<T>(name: string, attrs: Record<string, string|number>, fn: () => T): T
  ```

  which, when `this.tracer` is null (disabled OR api absent OR no SDK), just calls `fn()`
  synchronously — zero allocation on the hot path.
- Interceptor integration (reuse the SAME interceptor, no new binding): only wrap when
  `tracing.enabled` resolved true. Span name = `surface` + `route_class` (bounded, from
  TASK-3621), attributes limited to `http.method`, `route_class`, `surface` — NEVER the
  URL, key, bucket, or any header/credential (span attributes are as sensitive as logs;
  keep the STORY-0705 redaction posture). Set span status from the final HTTP status and
  `end()` in the same `tap` completion path.
- Externalization: because `@opentelemetry/api` is an OPTIONAL peer (not in the lib's
  `dependencies`), `apps/openbucket-backend/webpack.config.js` will NOT list it in
  `externalDependencies`, and the `require` is wrapped in try/catch — so the standalone
  bundle builds and runs whether or not OTel is installed. Document in the README that
  hosts wanting traces install `@opentelemetry/api` + an SDK and register a provider.
- Edge cases:
  - api present but no SDK registered → `getTracer` returns the no-op tracer; spans are
    created but do nothing. Acceptable (still cheap); the config gate avoids even that when
    disabled.
  - `tracing.enabled=true` but api NOT installed → log ONE `warn` at boot ("tracing enabled
    but @opentelemetry/api not found — tracing disabled") and no-op; do not throw (fail
    open to availability, since tracing is non-critical telemetry).
  - Async context: use `api.context`/`startActiveSpan` so the span is active for the
    duration of the RxJS handler; ensure `end()` runs on both `next` and `error`.

## Acceptance criteria

- [ ] With `tracing.enabled=false` (default), no OTel code path runs and `startActiveSpan` calls `fn()` directly (unit test asserts the api module is never required).
- [ ] The standalone bundle builds and boots with `@opentelemetry/api` NOT installed (no unresolved-module error).
- [ ] With `tracing.enabled=true` and a stub SDK/tracer registered, a request produces a span named by `surface`/`route_class` with only the bounded attributes and no URL/key/secret.
- [ ] `tracing.enabled=true` with api absent logs exactly one boot warning and does not throw.
- [ ] `@opentelemetry/api` is declared only under `peerDependencies` + `peerDependenciesMeta.optional`, never `dependencies`.
- [ ] `nx build nestjs` and `nx lint nestjs` pass.

## Test obligations

- Unit: covered by [TEST-1202] (no-op fallback when disabled/absent, span attributes redaction, single boot warning)
- E2E: covered by [TEST-1202] (span emitted through a registered stub tracer)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3621]
</content>
