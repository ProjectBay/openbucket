# Roadmap

Stories grouped into delivery milestones. Each Story belongs to
exactly one milestone. Milestones gate each other strictly: M(n+1)
work cannot begin until M(n) acceptance criteria are green.

| Milestone | Theme | Stories |
|-----------|------|---------|
| M0 | Workspace & bootstrap | 18 |
| M1 | Persistence foundation | 16 |
| M2 | Core S3 read/write | 17 |
| M3 | Multipart + presigned URLs | 8 |
| M4 | Admin API + Angular SPA + JWT | 20 |
| M5 | Versioning + Lifecycle + Object Lock | 9 |
| M6 | Docker image + CI + Conformance | 6 |
| M7 | Hardening (open questions) | 4 |
| M8 | Admin console UX & full S3 feature coverage | 18 |

Total: 116 Stories across 8 milestones (M7 holds §11 open questions; the first,
STORY-0119, is now committed work).

---

## M0 — Workspace & bootstrap

**Theme.** The Nest app boots deterministically, classifies requests,
serves health endpoints, hosts the SPA shell, and shuts down
gracefully. No S3, no persistence, no admin API yet.

**Exit criteria.**
- `nx serve backend` boots; `/api/admin/health` returns 200.
- A SIGTERM during an in-flight admin request drains within 30 s.
- The classifier middleware correctly tags every request kind.
- Env validation refuses to boot when required vars are missing.

**Stories.**
- STORY-0001 — Scaffold backend Nx app and directory layout
- STORY-0002 — Implement bootstrap main.ts with Express adapter, Pino, timeouts
- STORY-0003 — Implement opt-in body parsers for admin routes
- STORY-0004 — Compose AppModule root with ordered imports and middleware
- STORY-0005 — Augment Express.Request with OpenBucketRequestContext
- STORY-0006 — Implement UUIDv7 request-id middleware
- STORY-0007 — Implement request classifier middleware (S3 vs admin vs SPA)
- STORY-0008 — Wire CommonModule with global filters, pipes, interceptors
- STORY-0009 — Implement S3ExceptionFilter scaffold (XML, request-id, kind gate)
- STORY-0010 — Implement AdminExceptionFilter, catch-all filter, and Zod validation pipe
- STORY-0011 — Implement Zod-validated env schema and AppConfigService
- STORY-0012 — Add /api/admin/health and /api/admin/ready endpoints
- STORY-0013 — Serve Angular admin SPA under /admin with cache headers and fallback
- STORY-0014 — Implement ShutdownState service and in-flight tracker interceptor
- STORY-0015 — Implement SIGTERM shutdown coordinator with drain deadline
- STORY-0309 — HTTP server timeouts calibrated for object storage
- STORY-0310 — UV_THREADPOOL_SIZE=16 before any require

> Reclassified during M0 implementation: **STORY-0319** (ShutdownService
> 5-step ordering, §4.12) moved to **M3**. Its dependencies — STORY-0313
> (BackgroundService) and `BlobStore.close` / `MikroORM.close` (EPIC-03) —
> do not exist in M0. The §1.10 coordinator (STORY-0015) provides M0's
> shutdown behaviour; STORY-0319 supersedes it once persistence + the
> background scheduler land.

---

## M1 — Persistence foundation

**Theme.** All durable state lives behind MikroORM and the BlobStore.
SQLite is in WAL mode, all entities and the initial migration are in
place, the BlobStore writes atomically, and the orphan scan runs on
boot.

**Exit criteria.**
- `mikro-orm migration:up` on an empty volume creates the full schema.
- A unit test round-trips every entity.
- `putBlob` of a multi-MB stream is atomic across crash injection.
- Key encoding round-trips ASCII, UTF-8, `/`, leading `.`, trailing space.
- `KeyService.getSecret` returns `null` for unknown and disabled keys alike.
- Orphan scan logs (does not delete) on a seeded inconsistency.

**Stories.**
- STORY-0200 — MikroORM bootstrap with WAL PRAGMAs and request-scoped EM
- STORY-0201 — Define core object entities (Bucket, ObjectEntity, ObjectVersion)
- STORY-0202 — Define multipart entities (MultipartUpload, MultipartPart)
- STORY-0203 — Define auth and admin entities (AccessKey, AdminUser, RefreshToken)
- STORY-0204 — Define LifecycleState entity and persistence barrel
- STORY-0205 — Initial migration and boot-time `migration:up`
- STORY-0206 — Repository pattern (BucketRepository, ObjectRepository)
- STORY-0207 — Filesystem-safe key encoding (`encodeKey`/`decodeKey`)
- STORY-0208 — BlobStore — atomic stage-and-rename filesystem layer
- STORY-0209 — Two-phase commit `ObjectWriterService`
- STORY-0210 — Startup crash recovery and orphan-blob scan
- STORY-0211 — Trash manifest schema and write-after-move ordering
- STORY-0212 — `KeyService.getSecret` interface for SigV4 lookup
- STORY-0213 — Versioning storage (`VersionStoreService`, demote-on-write)
- STORY-0317 — OrphanScanRunner one-shot at bootstrap
- STORY-0318 — Clock abstraction with TestClock and OPENBUCKET_TEST_MODE advance endpoint

---

## M2 — Core S3 read/write

**Theme.** A real S3 client can `mb`, `ls`, `cp`, `rm`, and list
objects. PUT and GET stream. Range requests work. SigV4 verifies on
every request. Errors come out as canonical S3 XML.

**Exit criteria.**
- `aws s3 mb`, `s3 ls`, `s3 cp`, `s3 rm` succeed end-to-end.
- A 1 GiB PUT streams with bounded memory and a matching MD5.
- `GET` with `Range: bytes=...` returns 206 and exact bytes.
- Malformed signatures return `403 SignatureDoesNotMatch` with XML body.
- `ListObjectsV2` paginates with HMAC-sealed continuation tokens.
- aws-cli conformance Test Plans for service / bucket CRUD / object CRUD are green.

**Stories.**
- STORY-0100 — S3 controller topology and dispatcher pattern
- STORY-0101 — RouteResolver for virtual-host vs path-style routing
- STORY-0102 — XML request/response handling
- STORY-0103 — SigV4 verification core (header-based) and canonical request
- STORY-0105 — S3Error class hierarchy and error taxonomy
- STORY-0106 — S3 XML exception filter
- STORY-0107 — Service-scope operations (ListBuckets)
- STORY-0108 — Bucket CRUD and listing operations
- STORY-0109 — Object CRUD operations
- STORY-0118 — ListObjectsV2 pagination with HMAC-sealed continuation token
- STORY-0300 — RawReq decorator for unbuffered request streams
- STORY-0301 — PutObjectInterceptor with hash, size-cap, and MD5/SHA256 verification
- STORY-0302 — PUT object handler streaming to BlobStore
- STORY-0303 — GET object handler streaming from disk with fd cleanup
- STORY-0304 — Single-range HTTP Range header parser
- STORY-0311 — Backpressure invariants and explicit highWaterMark settings
- STORY-0312 — Concurrency invariants doc and O_EXCL collision tolerance

---

## M3 — Multipart + presigned URLs

**Theme.** Large-object workflows. Initiate/Upload/Complete/Abort,
presigned PUT and GET, and the background tick that sweeps abandoned
multipart uploads.

**Exit criteria.**
- Multipart upload of a 5-part object completes; ETag matches `MD5(concat(MD5(part_i)))-5`.
- AbortMultipartUpload removes staging and rows.
- `aws s3 presign` URLs verify and serve correctly.
- The background scheduler runs without piling up under a long tick.

**Stories.**
- STORY-0104 — Presigned URL verification
- STORY-0110 — Multipart upload operations
- STORY-0305 — InitiateMultipartUpload handler
- STORY-0306 — UploadPart handler with O_EXCL staging and per-part ETag
- STORY-0307 — CompleteMultipartUpload with 5 MiB minimum and multipart-ETag
- STORY-0308 — AbortMultipartUpload handler
- STORY-0313 — BackgroundService scheduler with no-pile-up semantics
- STORY-0315 — MultipartCleanupRunner tick
- STORY-0319 — ShutdownService 5-step ordering with stream drain deadline (moved from M0; needs STORY-0313 + EPIC-03)

---

## M4 — Admin API + Angular SPA + JWT

**Theme.** Operators can log in, browse buckets and objects, manage
access keys, and observe activity. Refresh-token rotation enforces
reuse revocation. The Angular SPA refreshes silently on a single 401.

**Exit criteria.**
- Login → JWT issued + refresh cookie set (scoped to `/api/admin/auth`).
- Replaying a rotated refresh token revokes the chain.
- The SPA lists buckets and browses objects after a clean login.
- Admin upload via `PUT /api/admin/buckets/:name/objects/:key(*)` lands a blob.
- Audit events are emitted as structured Pino lines.

**Stories.**
- STORY-0400 — Wire AdminModule tree and global JWT guard
- STORY-0401 — Stand up AuthModule and AuthService
- STORY-0402 — Implement RefreshTokenService with rotation and reuse revocation
- STORY-0403 — Implement POST /api/admin/auth/login with refresh cookie
- STORY-0404 — Implement POST /api/admin/auth/refresh
- STORY-0405 — Implement POST /api/admin/auth/logout
- STORY-0406 — Implement GET /api/admin/auth/me
- STORY-0407 — Implement JwtAuthGuard global admin guard
- STORY-0408 — Establish nestjs-zod DTO pattern with sample DTOs
- STORY-0409 — Implement admin bucket endpoints
- STORY-0410 — Implement admin object browser endpoints
- STORY-0411 — Implement access-key management endpoints
- STORY-0412 — Initial admin bootstrap and change-password flow
- STORY-0413 — Implement AuditService and event catalogue
- STORY-0414 — Bootstrap Angular SPA structure
- STORY-0415 — Implement SPA routing and auth guards
- STORY-0416 — Implement AuthService and single-retry refresh interceptor
- STORY-0417 — Wire the generated OpenAPI client into the SPA
- STORY-0418 — Object browser UI with prefix/delimiter pagination and uploads
- STORY-0419 — Signal-based state store pattern

---

## M5 — Versioning + Lifecycle + Object Lock

**Theme.** Compliance-tier S3 features. Versioning end-to-end,
per-bucket lifecycle expiration with trash purge, object lock and
legal hold, encryption defaults, tagging/ACL/policy, and CORS.

**Exit criteria.**
- A versioning-enabled bucket retains non-current versions on PUT.
- A lifecycle expiration rule moves objects to trash, then trash purge deletes them.
- Object lock in compliance mode rejects deletes during retention.
- `aws s3api put-bucket-cors`, `put-bucket-versioning`, `put-bucket-lifecycle-configuration` round-trip.

**Stories.**
- STORY-0111 — Tagging, ACL, and Policy operations
- STORY-0112 — Bucket CORS configuration operations
- STORY-0113 — Bucket versioning operations
- STORY-0114 — Bucket lifecycle configuration operations
- STORY-0115 — Object lock configuration, retention, and legal hold
- STORY-0116 — Bucket encryption operations
- STORY-0117 — CORS preflight handling per bucket
- STORY-0314 — LifecycleSweepRunner with cursor pagination and days/date eval
- STORY-0316 — TrashPurgeRunner tick

---

## M6 — Docker image + CI + Conformance

**Theme.** The single-image deliverable. Reproducible build, generated
API client, conformance gate green against three real S3 clients.

**Exit criteria.**
- `docker build .` produces a runnable `:latest` image from a clean checkout.
- `lint-and-test`, `e2e`, `build-image` jobs all green on PR.
- `conformance` job exercises aws-cli, mc, s3cmd, AWS SDK against the built image and is green on PR-to-main.
- Committed `@openbucket/api-client` is byte-equal to a fresh regeneration.

**Stories.**
- STORY-0500 — OpenAPI export and Angular client generation pipeline
- STORY-0501 — Docker multi-stage build image
- STORY-0502 — CI base lint, unit, and e2e workflow
- STORY-0503 — CI Docker image build workflow
- STORY-0504 — CI S3 conformance suite (aws-cli, mc, s3cmd, AWS SDK)
- STORY-0505 — Testing patterns — unit, e2e, and conformance sample templates

---

## M7 — Hardening (open questions)

Reserved for v2 work driven by `docs/ARCHITECTURE.md` §11 open
questions:

- Chunked-upload signing (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`) — implement or hold the v1 rejection?
- Object lock semantics — full WORM, or compliance-mode subset?
- Lifecycle evaluation cadence — cron-driven or event-driven?
- Abandoned multipart TTL default — 24 h (MinIO) vs never (AWS).
- Server-side encryption — single backend key vs per-bucket key vs KMS envelope.
- Bucket policy grammar coverage.
- Backup story — ship `openbucket dump`/`restore` CLI?
- Endpoint discovery UX when `OPENBUCKET_ENDPOINT` is unset.

**Stories.**
- STORY-0119 — Chunked-upload signing (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`)
- STORY-0120 — Unsigned trailer chunked upload (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`)
- STORY-0121 — Object-lock enforcement on delete (WORM)
- STORY-0122 — SSE-S3 encryption at rest (AES-256-CTR) — done

The first §11 open question to resolve into committed work: the 2026-06-24
conformance run showed `mc` requires chunked-upload signing, so the `mc` row is
skipped pending [STORY-0119]. The remaining open questions above stay unassigned
until they likewise resolve into committed work.

---

## M8 — Admin console UX & full S3 feature coverage

**Theme.** Make the admin SPA best-in-class by fully exploiting the stack
already in the repo (spartan-ng, the 12-theme/dark appearance engine,
ngrx/signals, the OpenAPI client) and by exposing the S3 capabilities the
backend already implements. Derived from a five-lens UX/UI review (2026-06-22):
design-system, interaction/async-state, information-architecture, accessibility,
and power-user/feature-coverage. See [EPIC-07].

**Exit criteria.**
- No hand-rolled table/modal/button markup on buckets/objects/keys/auth;
  every surface uses spartan-ng.
- Settings → Appearance switches any of 12 themes, light/dark, shell variant,
  and locale; every mutation toasts; destructive actions confirm; lists show
  skeleton + empty states (never a bare "Loading…").
- Object browser: multi-select + bulk delete, page-size + prefix search +
  counts, per-row actions, deep-linkable `?prefix=` URL.
- Keys, bucket-detail (versioning/encryption/tagging/lifecycle/CORS), and the
  dashboard are functional — no "Coming soon" placeholders.
- `nx lint openbucket-frontend` green with angular-eslint a11y rules at `error`;
  WCAG 2.2 AA across all 12 themes; full keyboard + screen-reader operability.
- New admin endpoints expose the S3 config surface; the committed
  `@openbucket/api-client` stays byte-equal to a fresh regeneration.

**Stories** (dependency order — foundations, backend unlock, core screens, feature screens, hardening).
- STORY-0600 — Shared UX kit: toasts, confirm dialog, copy-button, live-region announcer
- STORY-0601 — App-shell cleanup, brand component & page-header unification
- STORY-0602 — Domain navigation, routing, breadcrumbs & 404 page
- STORY-0612 — Admin REST endpoints for the S3 config surface + client regeneration
- STORY-0603 — Buckets list on spartan-ng (create dialog, delete-confirm, badges, states)
- STORY-0604 — Object browser rebuild: spartan table, multi-select, bulk delete, row actions
- STORY-0605 — Object listing UX: pagination, page-size, prefix search, counts, deep-link
- STORY-0606 — Upload UX overhaul: progress, drag affordance, cancel/retry, summary
- STORY-0607 — Appearance & Settings screen (themes/dark/shell/locale) + change-password
- STORY-0608 — Auth & login polish on the design system (login, force-rotate)
- STORY-0609 — Dashboard / home overview
- STORY-0610 — Command palette ⌘K & keyboard shortcuts
- STORY-0611 — Access-keys management screen
- STORY-0613 — Bucket-detail tabbed page (versioning, encryption, tagging, lifecycle, CORS, policy)
- STORY-0614 — Object versions, tagging & retention UI
- STORY-0615 — Presigned share links
- STORY-0616 — Accessibility & inclusive-design hardening (WCAG 2.2 AA)
- STORY-0617 — i18n completeness for feature screens

> M8 is independent of M7 and may proceed in parallel; it depends only on
> M4–M6 (admin API, SPA, OpenAPI client) being green.
