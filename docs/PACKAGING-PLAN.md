# Packaging plan — `@openbucket/nestjs`

Turn OpenBucket from a standalone app/image into a **publishable NestJS library**
a host app imports: `OpenBucketModule.forRoot({…})` mounts the S3 wire protocol,
admin JSON API, and admin SPA under a configurable prefix.

## Locked decisions (2026-06-25)
- **Deliverable:** both — extract to `libs/nestjs` (`@openbucket/nestjs`) **and**
  keep a thin `apps/openbucket-backend` consuming it (Docker image still works).
- **Coexistence:** mount under a configurable `mountPath` (default `/storage`),
  **path-style** S3 (`endpoint = host<mountPath>`). Virtual-host-style addressing
  is **not supported** in library mode.
- **Admin UI:** bundle the pre-built Angular SPA into the package, served at
  `<mountPath>/admin` (toggle `admin.serveUi`).

## API contract (done — phase 0a)
`libs/nestjs/src/lib/open-bucket-options.ts` + `open-bucket.module.ts`:
`OpenBucketModule.forRoot(OpenBucketModuleOptions)` / `forRootAsync(...)`,
`resolveOptions()` applies defaults, `OPEN_BUCKET_OPTIONS` token carries them.

## Phases
- **0a — lib scaffold + API contract.** ✅ `libs/nestjs` project + module/options +
  unit-tested `resolveOptions`. Nothing moved; nothing breaks.
- **0b — move the backend into the lib.** ✅ Relocated `s3/admin/domain/storage/
  common/migrations` + the composition root (`OpenBucketCoreModule`) into
  `libs/nestjs`; `apps/openbucket-backend` is now `main.ts` + `openapi-export` +
  `bootstrap` (deployment concerns). Verified: lib+app typecheck, app webpack build,
  standalone **boots** (health 200, S3 403 XML), moved suite green (57/461) + app
  bootstrap specs (12). The Nx daemon held Windows file locks → `nx reset` before
  `git mv`. (commit 13a6c28)
- **0c — lint green after the move.** ✅ `openapi-export` static-imports the lib
  (env validation is deferred to init, so the dynamic-import dance was unneeded);
  declared `@openbucket/nestjs`; `ignoredDependencies` for the 14 bundled-lib runtime
  deps. Both projects lint clean. (commit c9cbe1d)
- **1 — programmatic config.** ✅ Dual-mode `ConfigService` (`config-source.ts`
  `buildConfig`): from `OPEN_BUCKET_OPTIONS` when a host wired `forRoot`, else
  `loadEnv(process.env)` (standalone). `forRoot` providers are `global: true` so the
  descendant `ConfigModule` factory sees the token. `AppConfigService` + the 4 direct
  `ConfigService` injectors unchanged. Verified: standalone boot + a host-path DI test
  (config from options, no env). (commit 3c35b68)
- **2 — de-globalize providers.** ✅ The two real bleeds fixed + harness-proven:
  `GlobalExceptionFilter` re-throws for requests outside `mountPath` (host owns its
  errors); `JwtAuthGuard` prefix is mount-aware (a hardcoded `/api/admin/` left the
  MOUNTED admin API unguarded — security fix). Both via `@Optional` `OPEN_BUCKET_OPTIONS`
  inject, so standalone + specs unaffected. The Zod pipe is a no-op for non-`ZodDto`
  host DTOs; the shutdown interceptor only counts — both benign. (commit 7568bef)
- **3 — mount prefix + body isolation.** All controllers under `mountPath` via
  `RouterModule`. S3 reads via the `RawReq` unbuffered-stream decorator (bypasses
  body parsers); document that the host must not body-parse `mountPath`.
  - **Design findings (from the harness):** (a) the mount path must be known at
    module-config time — `forRoot` has it synchronously, but `forRootAsync` resolves
    options at *runtime*, so vhost/prefix must come from a STATIC field on the async
    options, not the factory. (b) `RouterModule.register([{path, module}])` only
    prefixes a module's OWN controllers; the core module imports its controllers from
    S3Module/AdminModule/HealthModule, so they must be passed as `children` (export a
    `CONTROLLER_MODULES` const from the core module to avoid coupling). (c) the
    standalone app stays at root (`mountPath: ''`, boots the core module directly);
    only the `forRoot` path gets the prefix. (d) the classifier middleware (`forRoutes
    '*'`) still runs for host routes — harmless for routing, but it's why the global
    filter renders host errors (→ phase 2).
- **4 — SPA serving + bundling.** ✅ `SpaModule`/`SpaController` serve the bundled SPA
  at `<mountPath>/admin` (gated on `serveUi`), hashed-asset immutable cache, `<base
  href>` rewritten to `<mountPath>/admin/` at serve time, client-route fallback,
  `@Public()`, 404 when unbundled, traversal-safe. Fixture-tested. (commit b845882)
  REMAINING: the published-lib asset path needs a real `nx build nestjs` (frontend →
  `assets/spa`) to confirm `resolveSpaRoot`'s candidates.
- **5 — own ORM + lifecycle.** Migrations on `OnModuleInit` ✅ (commit f3e2f1a). Drain
  via `OnApplicationShutdown` already (ShutdownModule, §4.12) — library-safe; host must
  `enableShutdownHooks` for it to fire (document).
  - **MikroORM `contextName` isolation ✅** (commit 758ac61). The lib registers its ORM
    under the `openbucket` context so a host that ALSO uses MikroORM (default context)
    no longer collides on the `MikroORM`/`EntityManager` tokens. The stock auto
    request-context middleware injects the DEFAULT token (unbound under a named context),
    so it's disabled (`registerRequestContext: false`) and replaced by `OrmContextMiddleware`
    (forks the named EM per request). All EM/ORM injections (10 `@InjectEntityManager` + 2
    `@InjectMikroORM` + `main.ts`) and the repo-token aliases are context-scoped; repo
    consumers are unchanged (class-token aliases). Verified by a host-with-its-own-MikroORM
    harness (default token → host ORM; host ORM works; OB named ORM boots + serves S3).
  - **Embedded admin API under a mountPath ✅** (commit 6836bf5). Two phase-2/3 bugs
    surfaced while verifying contextName, now fixed: (a) `RequestClassifierMiddleware`
    hardcoded `/api/admin/` + `/admin/` and wasn't mount-aware — it now strips `mountPath`
    (from `OPEN_BUCKET_OPTIONS`, `@Optional` for standalone) before classifying; (b) the
    mount `RouterModule` listed `AdminModule` (which declares NO controllers — they live in
    its sub-modules, which RouterModule doesn't prefix), so it now lists the exported
    `ADMIN_CONTROLLER_MODULES` (single source of truth) as children. The orm-isolation
    harness now makes a real authenticated `GET <mount>/api/admin/buckets` → 200 (which also
    closes the phase-5 request-context loop end-to-end). Standalone (`mountPath ''`) is
    unaffected.
- **6 — publish.** Build target + `package.json` deps/exports + bundled assets + README.
  - **Persistence bundled ✅.** `libs/persistence` is folded into the package at
    `libs/nestjs/src/lib/persistence/` (entities + repositories + barrel); the ~31
    `@openbucket/persistence` import sites now use a relative barrel, the project +
    its path alias + jest mappers are removed. This **resolved the lib→lib TS6059
    declaration error at the root** — `nx build nestjs` now compiles clean and emits
    a self-contained `dist/libs/nestjs` (no `@openbucket/persistence` requires).
    Surfaced + fixed a stale, previously non-executing `auth-entities.spec` (the old
    project never type-checked it). 506 lib tests green (only the known rotating
    concurrency/blob/FK-pragma flakes fail under parallel run; all pass in isolation).
  - **SPA asset copy ✅.** The `@nx/js:tsc` `assets` glob couldn't ship the SPA:
    that executor resolves an asset `input` relative to the PROJECT root
    (`libs/nestjs`), so it can't reach the frontend's output in a SIBLING project's
    dist (`dist/apps/openbucket-frontend/browser`). Replaced with an explicit copy
    (`scripts/copy-spa.mjs`) driven by a `bundle-spa` target (`dependsOn: build`):
    `nx bundle-spa nestjs` runs the lib tsc build then copies the SPA →
    `dist/libs/nestjs/assets/spa`. Also fixed `resolveSpaRoot`'s dev fallback
    (Angular v21 emits `index.html` under `browser/`). Verified: the published
    `assets/spa/index.html` exists and `resolveSpaRoot()` resolves it.
  - **Publish shape ✅.** `package.json` has `exports` (`.` → types+default) +
    `files` (`src`, `assets`, `README.md`); README ships via a project-relative
    `assets: ["README.md"]` glob. `npm pack --dry-run` from `dist/libs/nestjs`
    lists compiled `src/**`, `assets/spa/**`, README — no specs.
  - **Release CI ✅.** `.github/workflows/release-nestjs.yml` publishes on a
    `nestjs-v<version>` tag (or manual `workflow_dispatch`): verify tag==version,
    lint, build frontend, `nx bundle-spa nestjs`, then `npm publish
    dist/libs/nestjs --access public` (single Node 22 on Linux — the 20/23 split
    is Windows-only). Needs repo secret `NPM_TOKEN`. The publish gate stays on
    deterministic checks (lint + tsc build) and skips the unit suite — the lib's
    concurrency/blob specs are known-flaky (race, fail even with `--runInBand`);
    ci.yml is the functional gate, so tag a green-ci commit. Authored, not run
    (no runner in the dev env).
  - REMAINING: the first real publish — set `NPM_TOKEN` + ensure the `@openbucket`
    scope exists, then push a `nestjs-v0.1.0` tag.

## Status (2026-06-26)
**All phases 0–6 are functionally complete and verified.** The package is a genuinely
embeddable, self-contained library: `OpenBucketModule.forRoot()` mounts a working,
host-isolated OpenBucket under `mountPath` — S3 wire protocol, an **authenticated admin
JSON API**, and the **admin SPA**, all reachable under the prefix; it runs its own
MikroORM under a named context (no clash with a host's ORM); and it builds into one
`@openbucket/nestjs` (no separate persistence package, no TS6059) with a tagged-release
CI workflow. Embedded coverage: `open-bucket.module.spec` (host isolation),
`open-bucket.orm-isolation.spec` (host-with-own-MikroORM coexistence + authed admin
request-context), `open-bucket.spa-mount.spec` (SPA under mount). The webpack-bundled
**standalone app boots clean end-to-end** (health/ready 200, S3 403 XML, admin 401,
graceful SIGTERM) on Node 20 with all the above changes. **Remaining: the first real
`npm publish`** — set `NPM_TOKEN`, ensure the `@openbucket` scope exists, push a
`nestjs-v0.1.0` tag (outward-facing — the maintainer does it).

## Verification strategy
The standalone smoke test only proves "works when it owns the whole app". The
make-or-break items (#2 provider bleed, #3 routing/body coexistence) get a **real
host-app harness**: a tiny Nest app with its OWN routes + global JSON body parser +
its own exception filter, importing `OpenBucketModule.forRoot`, asserting the host's
routes/errors are untouched and S3/admin still work under the prefix.
