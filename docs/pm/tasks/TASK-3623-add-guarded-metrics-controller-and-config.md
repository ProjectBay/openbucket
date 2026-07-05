---
id: TASK-3623
title: Add the guarded /metrics controller, bearer guard, config knobs, and classifier/routing wiring
story: STORY-1202
status: backlog
type: implementation
size: L
---

## Description

Expose the scrape endpoint at `<mountPath>/metrics` via a `MetricsController` that
serializes the shared registry, guarded by a configurable mode (`off | public | token`).
Add a `MetricsAuthGuard` that, in `token` mode, timing-safe-compares a bearer token
against the configured `metricsToken`. Wire the three config knobs through all four
config seams, classify `/metrics` so SigV4 verification is skipped, and register the
controller before `S3Module` so the greedy `:bucket` route cannot shadow it.

## Files to create / modify

- `libs/nestjs/src/lib/common/metrics/metrics.controller.ts` — new (`@Controller('metrics')`, `@Public()`, returns `registry.metrics()`)
- `libs/nestjs/src/lib/common/metrics/metrics-auth.guard.ts` — new (`MetricsAuthGuard`: mode `off`→404/deny, `public`→allow, `token`→bearer check)
- `libs/nestjs/src/lib/common/metrics/metrics.module.ts` — modify (register controller + guard; skip controller when mode is `off`)
- `libs/nestjs/src/lib/open-bucket-core.module.ts` — modify (import `MetricsModule` in `buildCoreImports` BEFORE `S3Module`, alongside `HealthModule`)
- `libs/nestjs/src/lib/common/middleware/request-classifier.middleware.ts` — modify (classify bare `/metrics` as `admin`-kind so the SigV4 guard skips it)
- `libs/nestjs/src/lib/open-bucket-options.ts` — modify (`metrics?: { mode?; token? }` in options + resolved shape + `resolveOptions` defaults + `validateSecurityCriticalOptions` token check)
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (`METRICS_MODE`, `METRICS_TOKEN`)
- `libs/nestjs/src/lib/common/config/config-source.ts` — modify (map resolved options → `METRICS_MODE`/`METRICS_TOKEN`)
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify (`metricsMode`, `metricsToken` getters)

## Implementation notes

- Controller mirrors the `HealthController` public-probe pattern (`@Public()`, no JWT):

  ```ts
  @Controller('metrics')
  export class MetricsController {
    constructor(@Inject(PROM_METRICS) private readonly m: PromMetrics) {}
    @Public() @Get() @UseGuards(MetricsAuthGuard)
    async scrape(@Res() res: Response) {
      res.type(this.m.registry.contentType); // 'text/plain; version=0.0.4; charset=utf-8'
      res.send(await this.m.registry.metrics());
    }
  }
  ```

  `@Public()` is required because the global `JwtAuthGuard` (EPIC-08/STORY-0700) would
  otherwise 401 every scrape — Prometheus cannot perform a JWT login. Authorization is
  instead delegated to `MetricsAuthGuard`.
- `MetricsAuthGuard` reads `AppConfigService.metricsMode`:
  - `off` → the controller is not even registered (see module note); defensively the guard
    also denies. Result: `/metrics` falls through to the S3 `:bucket` route → clean 404-ish
    S3 error, never a stack trace.
  - `public` → allow (unauthenticated scrape — the intended default for a trusted network).
  - `token` → require `Authorization: Bearer <token>`; compare with
    `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` guarded by a length check
    (timingSafeEqual throws on length mismatch), returning `401 UnauthorizedException` on
    any miss. No token value is ever thrown into the message or logged.
- Config (4-seam) knobs, defaults `mode='off'`:
  - `open-bucket-options.ts`: `metrics?: { mode?: 'off'|'public'|'token'; token?: string }`
    on `OpenBucketModuleOptions` + `ResolvedOpenBucketOptions`; `resolveOptions` defaults
    `mode` to `'off'`. In `validateSecurityCriticalOptions`, when `mode==='token'` require
    `token` via `strongSecret('metrics.token')` (same fail-closed contract as
    `admin.jwtSecret` / `webhooks.secret`) — a `token` mode with a weak/empty token must
    fail at boot, not silently expose metrics.
  - `env.schema.ts`: `METRICS_MODE: z.enum(['off','public','token']).default('off')` and
    `METRICS_TOKEN: strongSecret(...).optional()` with a superRefine that requires the
    token when `METRICS_MODE==='token'` (mirror the webhook url/secret pairing).
  - `config-source.ts`: map `opts.metrics?.mode ?? 'off'` → `METRICS_MODE`,
    `opts.metrics?.token` → `METRICS_TOKEN`.
  - `app-config.service.ts`: `get metricsMode()` / `get metricsToken()` getters.
- Classifier edge case (IMPORTANT): bare `/metrics` currently matches neither `/api/admin`
  nor `/admin`, so `RequestClassifierMiddleware` falls through to path-style S3 and sets
  `ctx.kind='s3'`, `ctx.bucket='metrics'` — which makes `SigV4Guard` attempt SigV4
  verification and reject an unsigned Prometheus scrape. Add a branch (after the
  `/api/admin` and `/admin` branches, computed on the mount-relative `lowerPath`):

  ```ts
  if (lowerPath === '/metrics') { ctx.kind = 'admin'; return next(); }
  ```

  Marking it `admin`-kind makes the SigV4 guard skip it (it only verifies `s3`-kind), while
  `MetricsAuthGuard` does the real authz. Register `MetricsModule` in `buildCoreImports`
  next to `HealthModule` (BEFORE `S3Module`) so the concrete `metrics` route is mapped
  ahead of the greedy `@Controller(':bucket')`.
- Throttling: the `default` (admin, 100/min) throttler bucket applies since the route is
  not `@S3Throttled`; that is the correct DoS bound for a scrape endpoint. Do not exempt it.
- DoS: `registry.metrics()` cost is O(series); series are bounded by TASK-3620/3622
  cardinality controls, so a scrape is cheap and non-amplifying.

## Acceptance criteria

- [ ] With `metrics.mode='public'`, `GET <mountPath>/metrics` returns `200` + `text/plain; version=0.0.4` and the OpenBucket + default families.
- [ ] With `metrics.mode='token'`: no/blank/wrong `Authorization` → `401`; correct `Bearer <token>` → `200`; comparison uses `timingSafeEqual` (verified by test that unequal-length tokens do not throw).
- [ ] With `metrics.mode='off'` (default), `/metrics` is not served as metrics (falls through to the S3 route; no registry body leaked).
- [ ] A SigV4-signed vs unsigned scrape both work identically — the SigV4 guard does not run on `/metrics` (classifier sets `admin` kind).
- [ ] Boot fails with a clear message when `mode='token'` and the token is empty/weak (`validateSecurityCriticalOptions` + env schema).
- [ ] The token never appears in logs (covered by the existing `authorization` pino redaction path in `open-bucket-core.module.ts`).
- [ ] `nx build nestjs`, `nx lint nestjs`, and `nx test nestjs --testPathPattern=metrics` pass.

## Test obligations

- Unit: covered by [TEST-1202] (`MetricsAuthGuard` mode matrix, `timingSafeEqual` length-safety, config validation)
- E2E: covered by [TEST-1202] (public/token/off endpoint behaviour, content-type, no-SigV4)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3620], [TASK-3621], [TASK-3622]
</content>
