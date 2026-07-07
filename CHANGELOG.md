# Changelog

All notable changes to OpenBucket are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the `@openbucket/nestjs` package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor
versions may include breaking changes.

## [Unreleased]

## [0.1.0-alpha.18] — 2026-07-08

### Added

- **`openbucket hash` CLI command** — generate an argon2id `ADMIN_PASSWORD_HASH`
  offline (no admin API, no login), so `npx @openbucket/nestjs hash` works with no
  repository checkout. The password comes from a positional argument,
  `$OPENBUCKET_PASSWORD`, or a non-echoing prompt; only the hash is printed.
- **`OpenBucketFileInterceptor`** (`@openbucket/nestjs/multer`) — a one-line,
  DI-friendly upload interceptor that streams a multipart part straight into the
  store and hands your handler the committed object via `@UploadedToBucket()`.
  Previously the docs asked you to hand-roll this mixin; it now ships in the
  package. The lower-level `openBucketStorage(ob, opts)` engine remains exported
  for custom wiring.

### Changed

- npm publishes now attach **build provenance** (a verified "Published via GitHub
  Actions" badge on npmjs.com); the package `keywords` and `description` were
  broadened for discoverability.
- The Docker image now ships an **SBOM + SLSA build-provenance attestation** and a
  descriptive OCI image label.

### Security

- `.env.example` placeholder secrets are now intentionally invalid, so a copied
  `.env` refuses to boot rather than starting with insecure default credentials.

## [0.1.0-alpha.17] — 2026-07-06

### Fixed

- **Admin console:** the bucket object-browser pagination footer no longer stacks
  the item count, the Prev/Next pager, and the per-page selector onto three separate
  rows at constrained widths — the pager and selector are grouped so the footer stays
  count-left / controls-right and wraps as a unit.

### Changed

- **Release:** the `latest` npm dist-tag now tracks the newest published version
  until a stable (non-pre-release) ships, so `npm install @openbucket/nestjs` and the
  version shown on npmjs.com reflect the current build instead of an old alpha.

## [0.1.0-alpha.16] — 2026-07-06

### Security

- **Hardening from a CodeQL sweep.** Fixed a ReDoS-prone regex in the mount-path
  normalizer, the presigned-URL path trimmer, and the form URL validator (all now
  linear); bounded the key-codec encode loop; hardened the SigV4 authorization
  parser against prototype-property injection (null-prototype object + directive
  allowlist); and added a defense-in-depth path-containment barrier at the storage
  path choke-point (`resolve` + base-prefix assertion) so any segment that ever
  bypassed the key-codec fails closed instead of escaping the data directory. CI
  workflows gained least-privilege permissions and SHA-pinned actions.

_This release is the first shipped via a single `v*` tag (npm **and** Docker image
together)._

## [0.1.0-alpha.15] — 2026-07-05

### Added

- **`MOUNT_PATH` for the standalone image.** The standalone Docker image can now
  serve under a subpath (e.g. behind a reverse proxy at `https://example.com/storage/`)
  by setting `MOUNT_PATH`. The S3 API, admin console, and admin API all mount under
  the prefix, and the auth guard, SigV4 routing, presigned URLs, and the SPA
  base-href follow it. Unset = root (unchanged). `X-Forwarded-Prefix` is not trusted
  — `MOUNT_PATH` is the single authoritative prefix.

### Fixed

- **Documentation:** admonition callouts (`:::tip`, `:::warning`, …) rendered as
  literal text on the docs site — updated to the Docusaurus 3 `:::type[Title]` syntax.

_This is the first Docker image (`ghcr.io/projectbay/openbucket`) published since
alpha.1 — the standalone image is now current with the library._

## [0.1.0-alpha.14] — 2026-07-05

Feature release — adoption & observability (EPIC-13).

### Added

- **Multer storage engine** — `multer({ storage: openBucketStorage(ob, { bucket, key }) })`
  lets any Express/NestJS `FileInterceptor` app write uploads straight into OpenBucket
  (streamed, no temp files), plus an `@UploadedToBucket()` decorator. Exposed as the
  `@openbucket/nestjs/multer` subpath; `multer` is an optional peer dependency.
- **`openbucket` CLI** — bucket / access-key / backup / replication admin operations
  over the admin API (no extra runtime dependency; credential-safe).
- **Prometheus `/metrics` + optional OpenTelemetry.** A guarded (`off` / `public` /
  `token`) scrape endpoint at `<mountPath>/metrics` exporting HTTP request/latency,
  S3-operation, storage/object-count, and replication-lag metrics with bounded label
  cardinality. OpenTelemetry tracing activates only if `@opentelemetry/api` is present.
- **Scheduled backups & retention** — cron/interval snapshots with retention pruning
  and an optional push to the replication target; status + "Run now" in the console.
- **Integrity scrubbing** — a throttled background scrubber verifies stored objects
  against their `sha256` to detect on-disk bit-rot and repairs a corrupt object from
  the replication target when one is configured; surfaced in the admin API + console.

## [0.1.0-alpha.13] — 2026-07-05

### Changed

- **Admin console: consolidated the sidebar into Settings tabs.** Access Keys,
  Admin Users, Backup & Restore, Replication, and Audit Log — plus Appearance —
  are now tabs inside **Settings** (`/settings?tab=…`) rather than separate sidebar
  items; the sidebar is now Dashboard · Buckets · Search · Settings. Read-only
  admins do not see the Admin Users tab.

## [0.1.0-alpha.12] — 2026-07-05

Feature release — admin console v2 (EPIC-12).

### Added

- **Object preview** — preview images, PDFs, and text/code directly in the admin
  console (with a size cap and safe rendering), without a full download.
- **Cross-bucket object search** — find objects by name / prefix / tag across all
  buckets, keyset-paginated. Backed by an indexed object-tags table and a search
  admin endpoint (LIKE-escaped queries).
- **Usage analytics dashboard** — storage-over-time, per-bucket size breakdown, and
  request/error rates on the home dashboard, from periodic usage samples + a
  request-metrics interceptor and rollup.
- **Audit-log viewer** — a durable, queryable audit store (secret-stripped,
  retention-bounded) with a filterable console viewer over admin logins and
  bucket / object / key mutations.

## [0.1.0-alpha.11] — 2026-07-05

Feature release — multi-tenant access control (EPIC-11).

### Added

- **Scoped access keys.** An access key can be restricted to a bucket / key-prefix
  (previously every key was root). Scope is enforced on the S3 path through the
  bucket-policy evaluator — a request outside the key's scope is denied (403). Root
  credentials remain unrestricted, so existing single-root deployments are
  unchanged. The key secret is stored **encrypted at rest** (AES-256-GCM under an
  HKDF-derived instance key — recoverable only to verify SigV4, never plaintext,
  redacted from logs).
- **Per-key management** — rotate/revoke endpoints, an effective-permissions +
  policy-simulate endpoint, and a console scope builder.
- **Multi-admin users & roles** — admin users now carry a role; a read-only admin
  is blocked (403) from state-changing admin operations, while full-admins are
  unaffected. Admin-users CRUD (API + console) with last-full-admin / no-self-delete
  guardrails and immediate session eviction on change.

## [0.1.0-alpha.10] — 2026-07-05

Feature release — durability & cloud replication (EPIC-10).

### Added

- **Async replication to an external S3-compatible target** (AWS S3 / Cloudflare R2
  / Backblaze B2 / MinIO). Every committed PUT/DELETE is enqueued in a durable
  **transactional outbox** and mirrored by a background worker with per-key
  ordering, last-writer-wins coalescing, exponential-backoff retry, and a
  dead-letter cap — resuming on boot and surviving remote outages. Configure via
  `OB_REPLICATION_*` env vars or the `replication` module option.
- **Cold-object tiering** — objects not accessed within a policy window are
  offloaded to the replication target to free local disk; a `GET` transparently
  rehydrates them (read-through). Lifecycle `<Transition>` rules now drive tiering.
- **Replication status & reconcile** — an admin API + **console page** showing
  replication lag, last error, and per-bucket status, plus a manual
  reconcile/backfill job that re-enqueues objects missing on the remote.

## [0.1.0-alpha.9] — 2026-07-04

Feature release — the developer upload pipeline (EPIC-09).

### Added

- **On-the-fly image transformations.** `GET /bucket/photo.jpg?w=&h=&fit=&format=&q=`
  resizes/crops/converts images (via `sharp`), served from a content-addressed
  derivative cache with bounded parameters (no transform-bomb DoS) and a GC tick.
  Access control is unchanged — a transform GET still authorizes as `s3:GetObject`.
- **Object event notifications.** In-process typed NestJS events
  (`@OnObjectCreated()` / `@OnObjectDeleted()` / `@OnMultipartCompleted()`) emitted
  at the storage commit point for both the S3 and admin write paths, plus optional
  **signed HTTP webhooks** backed by a transactional outbox with retry/backoff.
- **Direct browser uploads.** Presigned POST policy support (`OpenBucketService`
  helper + a streaming `PostObject` endpoint) so browsers upload straight to the
  store, bypassing the app server.
- **Upload DX helpers on `OpenBucketService`** — magic-byte content-type sniffing,
  image-dimension probing, size/type validation, key strategies, and a one-call
  `uploadFrom()`. The README upload recipe is rewritten to use them.

## [0.1.0-alpha.8] — 2026-07-04

Security release — remediates a white-box security audit (EPIC-08, 22 confirmed findings).

### Security

- **CRITICAL — unauthenticated admin-API bypass (CWE-178).** The admin JWT guard
  gated authentication on a case-sensitive path prefix while Express routes
  case-insensitively, so a request like `GET /api/Admin/backup` reached the admin
  handler without a token — exposing whole-instance backup download, bucket CRUD,
  and S3 access-key minting to anonymous callers. The guard now compares
  case-insensitively (fail-closed).
- **HIGH — stored XSS → admin token theft.** Enabled a Content-Security-Policy and
  forced safe `Content-Type`/`Content-Disposition` on S3 object downloads.
- **Bucket policies are now evaluated** (previously stored but inert): explicit
  `Deny` is enforced, with default-allow so credentialed access is unaffected.
- Medium/low fixes: server-side CopyObject now decrypts + re-encrypts SSE objects;
  sessions/refresh tokens are revoked on password change; request/socket timeouts
  (slowloris); storage quota; SigV4 signatures + access-key IDs redacted from logs;
  restore decompression-bomb + manifest size caps; SignedHeaders coverage enforced;
  `mustChangePassword` enforced; S3 rate limiting; ListParts pagination; opaque CORS
  preflight (no bucket-existence oracle); aggregate key-length cap; SPA symlink
  check; LIKE-metacharacter escaping; low-entropy secret rejection; disabled
  `@scarf/scarf` install telemetry; `@nx/nest` moved out of production dependencies
  with an `npm audit` CI gate.

## [0.1.0-alpha.7] — 2026-07-03

### Added

- **Admin console: version & updates.** A version line in the sidebar footer (with
  a notification dot when a newer release exists) links to a new **About** page
  showing the running version, an update check against GitHub Releases, the full
  changelog (Markdown-rendered), and links to GitHub Releases + npm. New
  `GET /api/admin/version` endpoint, behind the admin JWT guard.

### Changed

- **Admin console: fixed layout defaults.** Shell layout (**inset**), tabs style
  (**underline**), and content alignment (**center**) are now fixed defaults; their
  controls were removed from Settings and any value persisted by an older build is
  ignored. Content width, theme, color scheme, language, and reduced-motion remain
  user-configurable.
- **Object browser: restyled the pagination bar** — a left-side item/page count,
  centered previous/next controls, and a right-aligned page-size selector.

## [0.1.0-alpha.6] — 2026-07-03

### Fixed

- **Storage: creating a folder returned HTTP 500.** A folder is a zero-byte object
  whose key ends in `/` (e.g. `photos/`); the filesystem key codec mapped the empty
  trailing segment to an empty path component, so the blob path ended in `/` and the
  write failed with `ENOENT`. Empty segments (trailing `/` or `//`) now encode to a
  reserved `%2F` placeholder — collision-free, since `/` never appears inside a
  segment, and it round-trips back to the original key.
- **Admin console: the page title/subtitle vanished when switching tabs** on a
  tabbed page (e.g. bucket detail). The page-header reset now fires only on a real
  route change, not on `?tab=` query-param navigations.
- **Admin console: the breadcrumb read "Buckets > Buckets"** inside a bucket — a
  route now uses its own breadcrumb data instead of inheriting the parent's.
- **Admin console: file-upload buttons leaked the browser's native "no file chosen"
  text.** The controls now use hidden inputs triggered by real buttons.
- **Admin console: the favicon is now the OpenBucket logo** (previously a default
  framework icon).

### Added

- **Settings: Content width** (Full / Extra wide / Wide / Medium / Narrow) and
  **Content alignment** (Left / Center), applied consistently across pages. Tabbed
  pages keep their tab bar full width; width/alignment apply to the tab content.
- **Object browser: file-type icons** next to each object name.
- **Docs: a "NestJS file uploads → OpenBucket → your database" recipe** (package
  README, docs site, and root README).

### Changed

- **Admin console (compact layout): the page header now sits inside the sticky top
  bar** (title/subtitle/action inline) instead of a separate block below it —
  denser, matching the intent of the "compact" variant.
- **Settings: added a "Tabs style" toggle** (Default / Underline) for the tab
  appearance, alongside the existing shell-layout control.
- **Lifecycle / CORS / bucket-policy editors: the add/edit form now opens in a
  dialog**; existing entries render as compact summary rows with Edit/Remove.

## [0.1.0-alpha.5] — 2026-07-03

### Fixed

- **Admin console (default "compact" layout) showed no page title or primary
  action button.** The compact shell rendered only the page *subtitle*, so page
  titles (e.g. "Buckets") and the header's primary action (e.g. "Create bucket")
  were invisible on the default layout. Compact now renders the full page header
  like the inset/sticky variants. The `PageHeaderService` also resets on
  navigation so header state never leaks between routes.

### Changed

- **Admin console UI refresh.** Dashboard KPI tiles now render with loading
  skeletons (shared `stat-card`); the bucket and access-key lists gain sortable
  column headers and a shared skeleton/error/empty state; the bucket-detail
  screen's tabs move to a reusable page-layout scaffold (still deep-linkable via
  `?tab=`, still lazy-loaded); and assorted header/consistency cleanups (e.g.
  backup & restore uses the unified page header).

## [0.1.0-alpha.4] — 2026-07-02

### Fixed

- **Admin console was unusable under a non-root `mountPath`** (e.g.
  `mountPath: '/storage'`): every API call 404'd (`POST /api/admin/auth/login`,
  `/refresh`, …) and, even once reachable, the session wouldn't persist. Two
  causes, both now mount-aware:
  - **Frontend** built every API/S3 URL root-absolute (`/api/admin/…`,
    `/<bucket>/<key>`), ignoring the mount. A new HTTP interceptor derives the
    mount prefix from the SPA's `<base href>` (which the backend rewrites to
    `<mountPath>/admin/`) and prepends it to all `/api/*` requests; the object
    "copy URL" share link is likewise prefixed. No-op for the standalone (root).
  - **Backend** set the refresh cookie with a hardcoded `path=/api/admin/auth`,
    so the browser never sent it to `<mountPath>/api/admin/auth/refresh`. The
    cookie `path` (set + clear) now includes the mount prefix.

## [0.1.0-alpha.3] — 2026-07-02

### Fixed

- **Admin SPA served 500 for every static asset under pnpm.** With
  `admin.serveUi: true`, the bundled console's hashed assets (`main-*.js`,
  `chunk-*.js`, `styles.css`, …) all failed under pnpm's default isolated layout.
  Express 5's `res.sendFile(absolutePath)` delegates to `send@1.x`, whose default
  `dotfiles: 'ignore'` rejects any path with a dot-prefixed segment — and pnpm
  stores the package under a `.pnpm/` directory, so every absolute asset path
  contained one. The SPA controller now serves root-relative
  (`res.sendFile(relative(spaRoot, file), { root: spaRoot })`), which exempts the
  root prefix from the dotfile check. npm/yarn's flat layout masked this.

## [0.1.0-alpha.2] — 2026-07-02

### Changed

- **SQLite driver swapped from `better-sqlite3` to `libsql`** (`@mikro-orm/libsql`).
  libsql exposes a better-sqlite3-compatible synchronous API (same `.pragma()`,
  same WAL + `synchronous=FULL` durability semantics — the fault-injection suite
  still reports 0 violations) but ships its native addon as **N-API prebuilds via
  platform-specific `optionalDependencies`** (`@libsql/*`). Those install with no
  build/compile step and are ABI-stable across Node majors, which fixes onboarding
  failures where the old prebuild couldn't be found (e.g. Node ≥ 24 ahead of
  better-sqlite3's prebuilds, or pnpm blocking install scripts). No config or data
  changes: the on-disk `openbucket.db` and pragmas are unchanged.

### Added

- **Fast-fail config validation for `OpenBucketModule.forRoot/forRootAsync`.**
  Malformed secrets now throw at module init with a clear message instead of
  failing later at login/first request: `jwtSecret` and `secretAccessKey` must be
  ≥ 32 chars, `passwordHash` must be an argon2id hash, and a supplied `sseKey` must
  be base64 of 32 bytes. (The AWS-format `accessKeyId` regex is intentionally *not*
  enforced in library mode — host apps may use arbitrary access-key strings.)

### Fixed

- The data-directory create step now wraps filesystem errors with an actionable
  message naming the offending `dataDir`/`DATA_DIR` (e.g. an unwritable
  `/var/lib/openbucket` on a dev box, or an uncreatable top-level path) instead of
  surfacing a bare `mkdir` errno.

## [0.1.0-alpha.1] — 2026-06-30

First public pre-release of OpenBucket, published to the npm `next` dist-tag
(`npm i @openbucket/nestjs@next`). The S3 surface and admin console are
feature-complete and tested; APIs may still change before 1.0.

### Added

- **Embeddable library** `@openbucket/nestjs`: `OpenBucketModule.forRoot()` /
  `forRootAsync()` mount the S3 wire protocol, admin API, and bundled admin SPA
  under a configurable `mountPath`, isolated under their own MikroORM context so
  they coexist with a host app's database. An injectable `OpenBucketService`
  facade drives the store in-process.
- **S3 wire protocol**: path-style addressing, SigV4 (header + presigned),
  streaming PUT/GET, multipart uploads, bucket/object tagging, versioning, object
  lock (governance/compliance retention + legal hold), SSE-S3 at-rest encryption,
  lifecycle expiration, CORS, bucket policies, and S3-style XML errors.
- **Admin**: a JSON admin API (argon2id + rotating JWTs) and an Angular admin
  console, including a bucket **Object Lock** editor (enable + governance/compliance
  default retention).
- **Standalone** Docker deployment (point any S3 SDK at it).
- **Documentation site** (Docusaurus) published to GitHub Pages at
  <https://projectbay.github.io/openbucket/>.
- Open-source project scaffolding: README, LICENSE (MIT), CONTRIBUTING, Code of
  Conduct, security policy, changelog, issue/PR templates, Dependabot, CodeQL, CI.

### Fixed

- Hashed Angular assets are now served with a 1-year `immutable` cache instead of
  `max-age=300` (the cache regex didn't match Angular v21's `name-HASH.ext`
  naming), in both the standalone app and the published library.

### Removed

- Dropped a dead `objects.signal-store.ts` scaffold stub from the frontend.

[Unreleased]: https://github.com/ProjectBay/openbucket/compare/nestjs-v0.1.0-alpha.5...HEAD
[0.1.0-alpha.5]: https://github.com/ProjectBay/openbucket/compare/nestjs-v0.1.0-alpha.4...nestjs-v0.1.0-alpha.5
[0.1.0-alpha.4]: https://github.com/ProjectBay/openbucket/compare/nestjs-v0.1.0-alpha.3...nestjs-v0.1.0-alpha.4
[0.1.0-alpha.3]: https://github.com/ProjectBay/openbucket/compare/nestjs-v0.1.0-alpha.2...nestjs-v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/ProjectBay/openbucket/compare/nestjs-v0.1.0-alpha.1...nestjs-v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/ProjectBay/openbucket/releases/tag/nestjs-v0.1.0-alpha.1
