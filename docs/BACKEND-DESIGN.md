# OpenBucket Backend — Design & Tooling

> Companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md). Where ARCHITECTURE.md describes *what* OpenBucket is, this document captures *how* the NestJS backend is built: module topology, library choices, and the operational discipline each subsystem requires.

---

## 0. Decisions at a glance

| Area | Choice | Realistic alternative |
|---|---|---|
| HTTP platform | Express adapter | Fastify adapter |
| Module topology | One Nest app, two controller trees (S3 + Admin) sharing services | Two sub-apps mounted on one HTTP server |
| ORM | MikroORM + libsql driver | Drizzle + better-sqlite3 |
| Validation | `nestjs-zod` (Zod-derived DTOs, swagger-integrated) | `class-validator` + `class-transformer` |
| Logging | `nestjs-pino` (JSON, structured) | Winston |
| Admin auth | JWT access (15m) in `Authorization` header + refresh in HttpOnly cookie | Pure cookie session |
| S3 auth | SigV4 reverse-verify via `aws4` | Hand-rolled canonical-request builder |
| Frontend API contract | OpenAPI 3 from `@nestjs/swagger` + `nestjs-zod` → generated Angular client | Hand-written Angular services + shared DTO lib |
| Testing | Unit + e2e (supertest) + S3 conformance suite (aws-cli, mc, s3cmd) | Unit + e2e only |

---

## 1. Module topology — one Nest app, two controller trees

A single `NestFactory.create` bootstraps the whole process. The S3 wire protocol and the admin JSON API share a domain layer; routing splits them by path.

```
apps/backend/src/
  main.ts                    // bootstrap, Express adapter, Pino logger
  app.module.ts
  s3/                        // S3 wire protocol
    s3.controller.ts         // catches everything not under /admin, /api, or SPA assets
    s3.module.ts
    sigv4.guard.ts
    xml.interceptor.ts       // XML body parsing + response serialization
  admin/                     // JSON admin API
    auth/                    // login, refresh, JWT issuance
    buckets/                 // admin CRUD
    objects/                 // admin browse/search
    admin.module.ts
  domain/                    // shared business logic — both trees consume
    buckets/
    objects/
    multipart/
    lifecycle/
    keys/
  storage/                   // filesystem blob layer (path-mirror)
  persistence/               // MikroORM entities, repositories, migrations
  spa/                       // static-serving module for Angular dist
  common/                    // pipes, filters, interceptors, logger, config
```

**Request classification.** A small middleware classifies each request once — `req.openbucket.kind = 's3' | 'admin' | 'spa'` — so guards and interceptors downstream don't re-derive it.

**Why not two sub-apps:** cleaner blast-radius isolation, but you pay double DI containers and lose trivial sharing of interceptors. Not worth it at v1 scale.

---

## 2. Persistence — MikroORM

**Why MikroORM fits**

- First-class SQLite driver (`libsql` under the hood — a better-sqlite3-compatible
  synchronous binding, distributed as ABI-stable N-API prebuilds — sync, fast).
- Unit-of-work + identity map: matters for multipart sessions where many parts mutate in one transaction.
- Schema-first migrations (`mikro-orm migration:create --initial` then incremental) — easier to reason about than TypeORM's sync mode for an embedded DB.
- Built-in soft-delete and filters — handy for object versioning and lifecycle "marked-for-deletion".

**Setup notes**

- Use `@mikro-orm/nestjs` with `MikroOrmModule.forRoot({ driver: LibSqlDriver, ... })`.
- Wrap each request in `RequestContext` via the provided middleware so `EntityManager` instances are per-request — entities never leak across requests.
- Place entities in an Nx lib (`libs/persistence`) so admin and S3 services can import them, but do **not** expose entities directly to controllers. Map to DTOs in services.
- Migrations live with the backend app, not in a lib — they need runtime config.

**SQLite tuning (run on boot, in MikroORM `afterCreate` hook)**

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store   = MEMORY;
PRAGMA mmap_size    = 268435456;   -- 256MB
```

WAL is the load-bearing setting — without it, one uploader blocks all readers.

**Alternative considered:** Drizzle + `better-sqlite3`. Lighter, type-safe SQL, no decorators — but no unit-of-work, which is genuinely useful for multipart and lifecycle batch jobs. Drizzle is the right call if you want fewer abstractions; MikroORM is the right call if you want Nest-shaped repositories without TypeORM's quirks.

---

## 3. HTTP & streaming — Express adapter, with streaming discipline

Express is chosen for ecosystem compatibility. The cost: default body-parsing will fight you on the S3 hot path. Configure deliberately.

**Body handling**

- Disable global `bodyParser`; opt-in per route.
- `PUT /:bucket/:key` uses a custom interceptor that pipes `req` (an `IncomingMessage`) directly into the storage layer's writable. No `@Body()`.
- XML admin operations (rare — `<CreateBucketConfiguration>`, `<Tagging>`, etc.) use a narrow XML body parser bound only to those routes.

**Range requests**

- Don't rely on `send`/`serve-static`. Use `fs.createReadStream(path, { start, end })` and set `Content-Range` / status `206` manually. Path-mirror layout doesn't play nicely with static-file middleware.

**Server timeouts**

- Set `server.requestTimeout` and `server.keepAliveTimeout` explicitly. Node 18+ defaults will close long-running multipart streams.

**Multipart hot path**

- Stage each part to `<DATA_DIR>/multipart/<upload-id>/<part-number>.part` while writing; rename atomically when complete.
- On `CompleteMultipartUpload`, compose the final object by concatenating parts into a temp file, then `fs.rename` to the final path.
- SQLite tracks the manifest; the filesystem holds bytes.

---

## 4. Authentication

### 4.1 Admin UI — JWT

- Short-lived access token (15 min) + refresh token (7 d).
- Refresh tokens are rotated on each use and stored hashed in SQLite.
- `@nestjs/jwt` + `@nestjs/passport` with `passport-jwt`. HS256 signed with a secret from env (refuse to boot if missing or too short).
- Single admin user → tokens carry `{ sub: 'admin', iat, exp }`. No roles in v1.
- Angular stores the access token in memory; refresh token rides in an `HttpOnly; Secure; SameSite=Strict` cookie. This sidesteps XSS-extracts-token while keeping the API stateless.

### 4.2 S3 protocol — SigV4 via `aws4` reverse-verify

- `aws4` is a signing library, used in reverse: reconstruct the canonical request server-side, call `aws4.sign` with the candidate secret, compare the produced `Authorization` to the incoming header.
- Wrapped in `SigV4Guard`, attached only to the S3 controller tree.
- Three signing variants to cover for MinIO parity:
  - Header-based (`Authorization: AWS4-HMAC-SHA256 ...`)
  - Query-string presigned URLs (`X-Amz-Signature` param)
  - Chunked uploads (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`) — each chunk has its own signature; `aws4` won't help directly. Custom stream handling required.
- Access-key lookup cached in memory; root-only for v1, but built as a service so sub-keys drop in later.

**Chunked uploads escape hatch.** For v1, you can reject `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` with a clear error and require clients to use unsigned-payload-with-trailer (`x-amz-content-sha256: UNSIGNED-PAYLOAD`). Most AWS SDKs fall back. Document the restriction in §10.

---

## 5. Validation + logging

### 5.1 nestjs-zod for DTOs

- Define each DTO as a Zod schema; derive the class via `createZodDto(schema)`.
- The same Zod schema drives `@nestjs/swagger` via `nestjs-zod`'s `patchNestjsSwagger()` — no duplicate decorators. This is the single biggest DX win for the OpenAPI-driven Angular client.
- Register a global `ZodValidationPipe` in `app.module.ts`.
- For S3 controllers: also parse query params and headers via Zod schemas (`X-Amz-*`, `partNumber`, `uploadId`).

### 5.2 nestjs-pino for logs

- `LoggerModule.forRoot({ pinoHttp: { ... } })`.
- Custom serializers redact `Authorization` and `X-Amz-*` signing headers — they contain HMACs but redaction is habit.
- Production: no `pino-pretty`. JSON to stdout; Docker handles the rest.
- Inject a `requestId` (UUID v7) via middleware so multipart traces are reconstructable across PUT-part calls.

---

## 6. Frontend API contract — OpenAPI-generated Angular client

**Wiring**

- `@nestjs/swagger` + `nestjs-zod`'s swagger patch → OpenAPI 3 spec at `/admin/openapi.json` (gated behind dev mode or admin auth).
- An Nx target (`generate-api-client`) runs `openapi-generator-cli` with the `typescript-angular` template, output into `libs/api-client`.
- The Angular admin app imports from `@openbucket/api-client`.
- CI fails if the generated lib is stale relative to the running spec.

**Important.** Only the **admin** API goes through OpenAPI. The S3 protocol surface is XML-over-HTTP, documented by AWS, not by your OpenAPI spec. Keep the two doc sources distinct.

**Generator choice.** `openapi-generator-cli` (typescript-angular) is the safe pick. `orval` is lighter with better tree-shaking, but its Angular support lags its React/Vue story. Stick with openapi-generator unless bundle size becomes an issue.

---

## 7. Testing — full pyramid

### 7.1 Unit (`*.spec.ts`)

- Services exercised in isolation; MikroORM repositories backed by a real in-memory SQLite (`:memory:`) created per suite.
- Don't mock the `EntityManager` with `jest.fn()` — using a real schema is faster to write *and* catches mapping bugs.

### 7.2 E2E (`*.e2e-spec.ts`)

- Boot the full Nest app on an ephemeral port; drive it with `supertest`.
- Real SQLite file under `tmp/`, wiped between suites.
- Covers both controller trees, but for S3 endpoints this only verifies routing — not wire-format correctness. That's the conformance suite.

### 7.3 Conformance (separate Nx target, against the built Docker image)

- Spin the container via `testcontainers` or `docker run`.
- Run a matrix of real clients:
  - `aws-cli` — most-used in practice; best signal.
  - `mc` (MinIO client) — exercises edge cases MinIO supports.
  - `s3cmd` — older protocol assumptions; surfaces compatibility regressions.
- Cover: bucket lifecycle, object PUT/GET/DELETE, multipart end-to-end, presigned URLs, versioning toggle, lifecycle expiration.
- For lifecycle/expiration tests, expose a hidden `/admin/_test/advance-clock` endpoint behind a build flag to simulate days passing without sleeping in CI.

### 7.4 CI shape

- Unit + e2e on every push.
- Conformance on PRs targeting `main` and on tags (it's slow).

---

## 8. Cross-cutting concerns

### 8.1 Config

- `@nestjs/config` + Zod schema; `ConfigService` returns a fully-typed object.
- Refuse to boot if any of these are missing: `DATA_DIR`, `JWT_SECRET`, `ROOT_ACCESS_KEY_ID`, `ROOT_SECRET_ACCESS_KEY`, `ADMIN_PASSWORD_HASH`.
- One env var per knob; document them in `README.md`; validate units (e.g., `MAX_OBJECT_SIZE_MB` must parse as a positive int).

### 8.2 Error mapping

- A global `ExceptionFilter` on the S3 controller tree converts thrown errors into S3 XML responses (`<Error><Code>NoSuchBucket</Code>...`). Non-negotiable — clients break on JSON errors at S3 endpoints.
- Admin tree uses the default Nest JSON error filter.
- Build a small `S3Error` class hierarchy (`NoSuchBucket extends S3Error`, etc.) with the AWS error code as a field.

### 8.3 Static SPA serving

```ts
ServeStaticModule.forRoot({
  rootPath: join(__dirname, 'spa'),
  serveRoot: '/admin',
  exclude: ['/api*'],
});
```

- Fallback to `index.html` for unknown `/admin/*` paths so Angular's router handles them.
- `Cache-Control: public, max-age=31536000, immutable` on hashed assets; `no-cache` on `index.html`.

### 8.4 Graceful shutdown

- `app.enableShutdownHooks()`.
- On `SIGTERM`: drain in-flight requests with a 30 s deadline, flush pending multipart cleanup, close MikroORM's EM.

---

## 9. Build & packaging notes

- Single Docker image, multi-stage build:
  1. Build Angular SPA → `apps/frontend/dist`.
  2. Build NestJS backend → `apps/backend/dist`.
  3. Copy SPA dist into backend dist under `spa/`.
  4. Final stage: `node:22-alpine`, copy `backend/dist`, `node_modules` (prod-only), run `node dist/main.js`.
- `libsql` ships native bindings as N-API prebuilds for both glibc and musl (`@libsql/linux-*-gnu` / `-musl`), so the SQLite driver works on either base; `argon2`, however, is glibc-linked, so match the build/runtime libc (alpine = musl) or use `node:22-bookworm-slim`.
- Expose port `9000` only. `DATA_DIR=/data` as the default mount point.

---

## 10. Open questions

Implementation-level open questions live alongside the product-level ones in [`ARCHITECTURE.md`](./ARCHITECTURE.md) §11.
