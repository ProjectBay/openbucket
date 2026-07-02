# OpenBucket — Implementation White Paper

> **Status:** implementation plan (v1). This document specifies *how* OpenBucket is built, in enough detail that a senior engineer can implement directly from it. It is the operational sibling of [`ARCHITECTURE.md`](./ARCHITECTURE.md) (the *what*) and supersedes [`BACKEND-DESIGN.md`](./BACKEND-DESIGN.md) (the summary-level *how*) at the level of code.

---

## Scope

OpenBucket is a **single-container, single-process, self-contained S3-compatible object store** with an embedded admin UI. One Docker image, one Node process, one host-mounted volume. No external database, no sidecars.

This white paper covers the implementation in five sections:

| § | Section | Owner concern |
|---|---|---|
| **1** | [Backend Architecture & Bootstrap](#1-backend-architecture--bootstrap) | NestJS topology, the classifier middleware, config, filters, shutdown |
| **2** | [S3 Wire Protocol & SigV4 Authentication](#2-s3-wire-protocol--sigv4-authentication) | XML serialization, SigV4 reverse-verify, full operation route table, error taxonomy |
| **3** | [Persistence & Storage Layer](#3-persistence--storage-layer) | MikroORM entities, migrations, path-mirror BlobStore, two-phase commit, crash recovery |
| **4** | [Streaming I/O, Concurrency & Background Work](#4-streaming-io-concurrency--background-work) | PUT/GET streaming, multipart, range requests, the background tick scheduler |
| **5** | [Admin API, Frontend, Auth & Delivery](#5-admin-api-frontend-auth-flow--delivery) | Admin endpoints, JWT flow, Angular SPA, OpenAPI client gen, Docker, CI |

Each section is implementable from the code it contains. Cross-references between sections appear as `[see §N]`.

---

## Locked-in decisions (from `BACKEND-DESIGN.md` §0)

| Area | Choice |
|---|---|
| HTTP platform | Express adapter |
| Module topology | One Nest app, two controller trees (S3 + Admin) sharing services |
| ORM | MikroORM + `libsql` (SQLite) |
| Validation | `nestjs-zod` (Zod-derived DTOs, swagger-integrated) |
| Logging | `nestjs-pino` |
| Admin auth | JWT access (15 m) + refresh in HttpOnly cookie scoped to `/api/admin/auth` |
| S3 auth | SigV4 reverse-verify via `aws4`; chunked-payload signing rejected in v1 |
| Frontend contract | OpenAPI 3 → generated Angular client |
| Image base | `node:22-bookworm-slim` (not alpine — `argon2` glibc dependency; `libsql` has both glibc/musl N-API prebuilds) |
| Testing | Unit + e2e (supertest) + S3 conformance (aws-cli, mc, s3cmd) |

---

## How to read this document

The sections are intentionally vertically deep. Reading top-to-bottom is the recommended path for an engineer about to implement; reading by section is the right path for an engineer touching a specific subsystem. Each section assumes the locked-in decisions above and the context in `ARCHITECTURE.md` §§1–11.

The code samples are not pseudocode. File paths are intended to match the resulting source tree. Where an interface is consumed in one section and implemented in another, both sections name the same method signature.

---
# 1. Backend Architecture & Bootstrap

This section specifies the structural backbone of the OpenBucket backend: how the single Node process boots, how one Nest application multiplexes three traffic types onto port 9000, and which scaffolding pieces every downstream subsystem can assume is already in place. Subsystem internals — S3 wire handling [see §3], persistence and the blob store [see §2], streaming and background ticks [see §4], the frontend [see §5] — are deliberately out of scope here. What is in scope is everything they hang off.

## 1.1 Directory layout

The Nx workspace already contains `apps/openbucket-backend/` and `apps/openbucket-frontend/`. For brevity this section uses the alias `apps/backend/` for the backend app's source root (`apps/openbucket-backend/src/`). The locked-in topology is one Nest app with two controller trees sharing a domain layer, and Nx libs for the parts that other apps (notably the generated Angular client) consume.

```
apps/backend/src/
  main.ts                          // bootstrap (§1.2)
  app.module.ts                    // root composition (§1.3)
  common/                          // cross-cutting plumbing (§1.6)
    common.module.ts
    config/
      env.schema.ts                // Zod env schema (§1.8)
      config.module.ts
      app-config.service.ts
    middleware/
      request-id.middleware.ts     // UUIDv7 per request
      request-classifier.middleware.ts  // s3 | admin | spa  (§1.5)
    filters/
      s3-exception.filter.ts       // XML response shape (§1.6.1)
      admin-exception.filter.ts    // JSON response shape (§1.6.2)
      catch-all.filter.ts          // last-resort guard
    pipes/
      zod-validation.pipe.ts       // re-exported from nestjs-zod with our settings
    interceptors/
      shutdown-tracker.interceptor.ts   // in-flight counter for drain (§1.10)
    types/
      request.d.ts                 // augments Express.Request with `openbucket`
  s3/                              // §3 — S3 wire controller tree
    s3.module.ts
    s3.controller.ts
    sigv4.guard.ts
    xml.interceptor.ts
  admin/                           // §6 — admin JSON API tree
    admin.module.ts
    auth/
    buckets/
    objects/
    health/
      health.controller.ts         // /api/admin/health, /api/admin/ready (§1.9)
      health.module.ts
  domain/                          // shared business logic (§2, §4)
    domain.module.ts
    buckets/
    objects/
    multipart/
    lifecycle/
    keys/
  storage/                         // §2 — filesystem blob layer
    storage.module.ts
  persistence/                     // §2 — MikroORM wiring (entities live in libs/persistence)
    persistence.module.ts
    mikro-orm.config.ts
  spa/
    spa.module.ts                  // ServeStaticModule wiring (§1.9.2)
  bootstrap/
    body-parser.ts                 // opt-in JSON/XML parsers (§1.2.3)
    shutdown.ts                    // SIGTERM coordinator (§1.10)
```

Top-level module responsibilities:

- **`AppModule`** — composition root. Loads config, logger, persistence, then domain, storage, S3, admin, spa, common.
- **`CommonModule`** — request-id, classifier, filters, pipes, shutdown tracker. Re-exports everything global. Imported by `AppModule` first.
- **`PersistenceModule`** — registers MikroORM with the entity classes from `libs/persistence`. Provides `EntityManager` via `RequestContext` middleware. Implementation details belong to the persistence agent [see §2].
- **`StorageModule`** — `BlobStore`, path-mirror layout, atomic-rename writers. Implementation details belong to the persistence/streaming agents [see §2, §4].
- **`DomainModule`** — `BucketService`, `ObjectService`, `MultipartService`, `LifecycleService`, `KeyService`. Pure business logic. Consumes `PersistenceModule` and `StorageModule`. Consumed by both controller trees.
- **`S3Module`** — the S3 wire protocol controller tree, `SigV4Guard`, XML serializer interceptor. Owned by the S3 agent [see §3].
- **`AdminModule`** — JSON admin API: auth, buckets browse/admin, objects browse, health. Owned by the admin/frontend agents [see §5, §6].
- **`SpaModule`** — `ServeStaticModule` configured for the Angular dist (§1.9.2).

## 1.2 Bootstrap — `main.ts`

`main.ts` does exactly four things: build the Nest app on the Express adapter with Pino as the logger, configure body parsing and timeouts, register the SIGTERM coordinator, then bind to the port. Global pipes/filters/interceptors are registered via DI in `CommonModule` so they participate in `RequestContext` — registering them here would deprive them of MikroORM's request-scoped `EntityManager`.

```ts
// apps/backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';
import { configureBodyParsers } from './bootstrap/body-parser';
import { installShutdownHandlers } from './bootstrap/shutdown';

async function bootstrap(): Promise<void> {
  const expressInstance: Express = express();

  // Disable Express's defaults. Body parsing is opt-in per route (§1.2.3).
  expressInstance.disable('x-powered-by');
  expressInstance.disable('etag');                  // we issue our own ETags for objects
  expressInstance.set('trust proxy', 'loopback');   // upstream TLS-terminating proxy

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressInstance),
    {
      bufferLogs: true,        // hold logs until Pino is bound
      rawBody: false,          // raw body opt-in via interceptors (S3 PUT streams req directly)
      bodyParser: false,       // see §1.2.3
    },
  );

  // Bind Pino as the application logger. nestjs-pino is registered in AppModule.
  app.useLogger(app.get(Logger));

  // Security headers — harmless on S3, useful on /admin SPA.
  app.use(helmet({ contentSecurityPolicy: false })); // CSP is configured per-route in SpaModule

  // Mount opt-in body parsers for admin routes only. S3 PUTs stay raw.
  configureBodyParsers(expressInstance);

  // Allow ConfigService access before listen().
  const config = app.get(AppConfigService);

  // Tune the underlying http.Server for long-lived multipart streams [see §4].
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 0;                // disable per-request timeout; streaming sets its own
  httpServer.headersTimeout = 60_000;           // 60s to send full request headers
  httpServer.keepAliveTimeout = 65_000;         // > headersTimeout so we stay friendly with HTTP/1.1
  httpServer.maxRequestsPerSocket = 0;

  // Shutdown hooks — Nest will call onModuleDestroy/onApplicationShutdown.
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  installShutdownHandlers(app, { drainTimeoutMs: 30_000 });

  await app.listen(config.port, '0.0.0.0');

  const url = await app.getUrl();
  app.get(Logger).log(`OpenBucket listening on ${url}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // Pino isn't bound yet if this throws during NestFactory.create; use stderr.
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
```

### 1.2.1 Why Express, not Fastify

Locked in by the design doc. Fastify would parse bodies more aggressively, which is hostile to the S3 hot path; Express's defaults are easier to suppress, and ecosystem middleware (helmet, the SigV4 reverse-verify path) is Express-shaped.

### 1.2.2 Body parsing — disabled globally, opt-in per route

Default body parsing buffers the entire request into memory before the controller runs. For an S3 `PUT` of a 5 GiB object this is unacceptable: the storage layer needs the raw `IncomingMessage` stream [see §4]. The strategy:

- `NestFactory.create` is passed `{ bodyParser: false }`.
- A helper mounts JSON and URL-encoded parsers only on `/api/admin/*`.
- XML parsing on admin routes that need it (`<CreateBucketConfiguration>`, `<Tagging>`) is handled by a narrow interceptor in those routes [see §3 for the analogous S3-side interceptor].
- All other routes — every S3 request, including `POST` multipart-initiate — receive `req` as a live readable stream.

```ts
// apps/backend/src/bootstrap/body-parser.ts
import { type Express, json, urlencoded } from 'express';

export function configureBodyParsers(app: Express): void {
  // JSON for admin API only. 1 MiB is generous for admin payloads;
  // anything larger is a bug, not a feature.
  const adminJson = json({ limit: '1mb', strict: true });
  const adminForm = urlencoded({ limit: '1mb', extended: false });

  app.use('/api/admin', adminJson);
  app.use('/api/admin', adminForm);

  // Everything else (including /admin/* SPA paths and S3 paths) stays raw.
  // S3 XML bodies are parsed by the S3 XML interceptor [see §3].
}
```

### 1.2.3 Global pipes / filters / interceptors

Registered through DI in `CommonModule` so MikroORM's `RequestContext` is active when they execute. Direct `app.useGlobalPipes(...)` registration in `main.ts` would run them outside that context.

## 1.3 Composition root — `app.module.ts`

`AppModule` wires everything. Order matters: config first (other modules read it), logger second (so persistence boot logs are structured), then persistence (so domain can inject the EM), then domain/storage/controllers, then SPA last so its catch-all doesn't shadow API routes.

```ts
// apps/backend/src/app.module.ts
import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { envSchema, loadEnv } from './common/config/env.schema';
import { CommonModule } from './common/common.module';
import { PersistenceModule } from './persistence/persistence.module';
import { StorageModule } from './storage/storage.module';
import { DomainModule } from './domain/domain.module';
import { S3Module } from './s3/s3.module';
import { AdminModule } from './admin/admin.module';
import { SpaModule } from './spa/spa.module';
import { AppConfigService } from './common/config/app-config.service';
import { RequestClassifierMiddleware } from './common/middleware/request-classifier.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    // 1. Config first — every other module reads it.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: loadEnv,        // Zod validation; throws synchronously on bad env (§1.8)
    }),

    // 2. Logger — picks up the request-id from req.openbucket.requestId.
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: (req) =>
            (req as { openbucket?: { requestId?: string } }).openbucket?.requestId ?? randomUUID(),
          customProps: (req) => ({
            kind: (req as { openbucket?: { kind?: string } }).openbucket?.kind,
            bucket: (req as { openbucket?: { bucket?: string } }).openbucket?.bucket,
          }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["x-amz-content-sha256"]',
              'req.headers["x-amz-security-token"]',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url,
              host: req.headers.host,
              remoteAddress: req.remoteAddress,
            }),
          },
          // No pino-pretty in production — Docker captures stdout JSON.
          transport: config.nodeEnv === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        },
      }),
    }),

    // 3. Persistence — MikroORM. Entity discovery lives in mikro-orm.config.ts [see §2].
    MikroOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        // The persistence agent owns this object's shape. We only assert here that
        // it must produce a usable EM and accept our config. See libs/persistence/mikro-orm.config.ts.
        ...require('./persistence/mikro-orm.config').buildMikroOrmConfig(config),
      }),
    }),

    // 4. Cross-cutting (filters, pipes, interceptors). Global by virtue of providers.
    CommonModule,

    // 5. Lower layers.
    PersistenceModule,
    StorageModule,
    DomainModule,

    // 6. Controller trees.
    S3Module,
    AdminModule,

    // 7. SPA last so its catch-all sits at the bottom of the route table.
    SpaModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order: request-id assigns req.openbucket.requestId, then the classifier
    // populates the rest of req.openbucket.
    consumer
      .apply(RequestIdMiddleware, RequestClassifierMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

Two notes for downstream agents:

- The persistence agent owns `apps/backend/src/persistence/mikro-orm.config.ts` and `libs/persistence/`. `AppModule` does not import entity classes directly.
- The `MikroOrmModule.forMiddleware()` registration that wraps each request in a `RequestContext` is added by `PersistenceModule` (so it stays adjacent to the rest of the persistence wiring), not here.

## 1.4 Augmenting `Express.Request`

The classifier attaches a single object to every request. Type-augment Express's `Request` so controllers and guards consume typed fields rather than `(req as any).openbucket`.

```ts
// apps/backend/src/common/types/request.d.ts
import 'express';

declare module 'express' {
  interface Request {
    openbucket: OpenBucketRequestContext;
  }
}

export interface OpenBucketRequestContext {
  /** UUIDv7 — monotonic, sortable. Logged on every line, returned as `X-Request-Id`. */
  requestId: string;

  /** Routing class. Decided once by the classifier middleware. */
  kind: 's3' | 'admin' | 'spa';

  /** Wall-clock receive time, for latency measurement and SigV4 skew checks. */
  receivedAt: number;

  // ---- s3-only fields ----
  /** Resolved bucket name (from host header in vhost style, or first path segment in path style). */
  bucket?: string;
  /** Resolved object key, percent-decoded. Empty for bucket-level operations. */
  key?: string;
  /** 'virtual-host' | 'path'. Drives URL shape in SigV4 canonicalization [see §3]. */
  addressingStyle?: 'virtual-host' | 'path';
  /** Sub-operation hint: 'service' | 'bucket' | 'object'. */
  s3Scope?: 's3-service' | 's3-bucket' | 's3-object';
}
```

This file is included via `tsconfig.app.json`'s `"types"` so the augmentation propagates through the backend without explicit imports at use sites.

## 1.5 Request classifier middleware

The classifier is the load-bearing routing piece: it runs once per request and tells every downstream consumer — guards, controllers, the logger, the exception filters — which traffic class they're dealing with. It must be cheap (allocations matter at S3 RPS), it must never throw (errors here become 500s before any filter is in scope), and it must be the *only* place that interprets the `Host` header for vhost-style addressing.

The decision tree:

1. Path starts with `/admin/` and is not `/api/admin/...` → SPA (Angular routes; the static module handles it).
2. Path starts with `/api/admin/` → admin JSON API.
3. `OPENBUCKET_ENDPOINT` is configured and the request's `Host` header is `<label>.<endpoint>` where `<label>` is a syntactically valid bucket name → S3 virtual-host style; `bucket = <label>`, `key = pathname.slice(1)`.
4. Otherwise → S3 path style; the first path segment (if any) is the bucket, the remainder is the key.

The classifier does **not** verify that the bucket exists — that's the controller's job, and producing a `NoSuchBucket` 404 requires database access. The classifier only parses.

```ts
// apps/backend/src/common/middleware/request-classifier.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import { AppConfigService } from '../config/app-config.service';

/**
 * RFC-3986-safe bucket label: 3-63 chars, lowercase alphanumerics and hyphens.
 * Mirrors AWS rules tightly enough for routing; the bucket service does the
 * stricter check (no consecutive dots, no IPv4 shape, etc.) [see §3].
 */
const BUCKET_LABEL = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

@Injectable()
export class RequestClassifierMiddleware implements NestMiddleware {
  private readonly endpointSuffix: string | null;

  constructor(config: AppConfigService) {
    // Stored once; the classifier hot path never touches ConfigService.
    this.endpointSuffix = config.endpoint ? `.${config.endpoint.toLowerCase()}` : null;
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    const ctx = req.openbucket; // RequestIdMiddleware created this skeleton
    ctx.receivedAt = Date.now();

    const path = req.path; // Express has already stripped query string
    const host = stripPort((req.headers.host ?? '').toLowerCase());

    // 1. /api/admin/* → admin API. Checked before /admin/ because it's the longer prefix.
    if (path === '/api/admin' || path.startsWith('/api/admin/')) {
      ctx.kind = 'admin';
      return next();
    }

    // 2. /admin/* → SPA. The ServeStaticModule will serve index.html for unknown subpaths.
    if (path === '/admin' || path.startsWith('/admin/')) {
      ctx.kind = 'spa';
      return next();
    }

    // 3. Virtual-host S3.
    if (this.endpointSuffix && host.endsWith(this.endpointSuffix)) {
      const label = host.slice(0, -this.endpointSuffix.length);
      if (label.length > 0 && BUCKET_LABEL.test(label)) {
        ctx.kind = 's3';
        ctx.addressingStyle = 'virtual-host';
        ctx.bucket = label;
        ctx.key = decodeKey(path.slice(1)); // drop leading '/'
        ctx.s3Scope = ctx.key === '' ? 's3-bucket' : 's3-object';
        return next();
      }
      // Looked like vhost but the label is malformed. Fall through to path style;
      // the S3 controller will produce the proper InvalidBucketName error.
    }

    // 4. Path-style S3 (default for everything else, including `/`).
    ctx.kind = 's3';
    ctx.addressingStyle = 'path';
    const [, first = '', ...rest] = path.split('/');
    if (first === '') {
      ctx.s3Scope = 's3-service'; // GET / → ListBuckets
    } else {
      ctx.bucket = first;
      const tail = rest.join('/');
      ctx.key = decodeKey(tail);
      ctx.s3Scope = tail === '' ? 's3-bucket' : 's3-object';
    }
    return next();
  }
}

function stripPort(host: string): string {
  // IPv6 hosts are bracketed: [::1]:9000
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

function decodeKey(pathSegment: string): string {
  try {
    return decodeURIComponent(pathSegment);
  } catch {
    // Malformed percent-encoding. Return raw; the S3 controller surfaces InvalidURI.
    return pathSegment;
  }
}
```

The companion request-id middleware runs first and is small enough to inline here:

```ts
// apps/backend/src/common/middleware/request-id.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { v7 as uuidv7 } from 'uuid';

import type { OpenBucketRequestContext } from '../types/request';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Honour upstream proxy's X-Request-Id if present (already validated UUIDv7-ish).
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : uuidv7();

    const ctx: OpenBucketRequestContext = {
      requestId,
      kind: 's3',           // overwritten by the classifier; this default never escapes
      receivedAt: 0,        // set by the classifier
    };
    req.openbucket = ctx;

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Amz-Request-Id', requestId); // S3 SDKs surface this in error messages
    next();
  }
}
```

UUIDv7 is mandated: lexicographically sortable by timestamp, which makes log triage and SQLite-indexed audit tables (if ever added) trivial.

## 1.6 Common module — filters, pipes, interceptors

`CommonModule` is the only module that registers global providers. It also re-exports the config service so other modules don't re-import `ConfigModule`.

```ts
// apps/backend/src/common/common.module.ts
import { Module, Global } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { ConfigModule as AppConfigInternalModule } from './config/config.module';
import { S3ExceptionFilter } from './filters/s3-exception.filter';
import { AdminExceptionFilter } from './filters/admin-exception.filter';
import { CatchAllExceptionFilter } from './filters/catch-all.filter';
import { ShutdownTrackerInterceptor } from './interceptors/shutdown-tracker.interceptor';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { RequestClassifierMiddleware } from './middleware/request-classifier.middleware';

@Global()
@Module({
  imports: [AppConfigInternalModule],
  providers: [
    RequestIdMiddleware,
    RequestClassifierMiddleware,
    ShutdownTrackerInterceptor,

    // Pipes
    { provide: APP_PIPE, useClass: ZodValidationPipe },

    // Filters — order is LIFO. The catch-all is registered first so it sits at
    // the bottom; the kind-specific filters above it intercept first.
    { provide: APP_FILTER, useClass: CatchAllExceptionFilter },
    { provide: APP_FILTER, useClass: AdminExceptionFilter },
    { provide: APP_FILTER, useClass: S3ExceptionFilter },

    // Interceptors
    { provide: APP_INTERCEPTOR, useClass: ShutdownTrackerInterceptor },
  ],
  exports: [
    AppConfigInternalModule,
    RequestIdMiddleware,
    RequestClassifierMiddleware,
  ],
})
export class CommonModule {}
```

### 1.6.1 S3 exception filter

This is scaffolding only. The S3 agent owns the full error-code → HTTP-status table and the canonical XML body shape [see §3]. The filter must (a) only handle requests with `kind === 's3'`, (b) emit `Content-Type: application/xml`, and (c) include the request id so support can correlate to logs.

```ts
// apps/backend/src/common/filters/s3-exception.filter.ts
import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { S3Error } from '../../s3/errors/s3-error';   // owned by §3
// import { renderS3ErrorXml } from '../../s3/wire/render-error-xml'; // owned by §3

@Catch()
export class S3ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(S3ExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    // Only handle S3-classified requests. Anything else falls through to the
    // admin filter or the catch-all.
    if (req.openbucket?.kind !== 's3') {
      throw exception;
    }

    const { status, code, message } = mapToS3Shape(exception);
    const bucket = req.openbucket.bucket ?? '';
    const key = req.openbucket.key ?? '';
    const requestId = req.openbucket.requestId;

    // The XML shape itself is owned by the S3 agent. The placeholder below is
    // the minimum a client will accept; replace with renderS3ErrorXml() once
    // §3 lands.
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Error>` +
      `<Code>${escapeXml(code)}</Code>` +
      `<Message>${escapeXml(message)}</Message>` +
      `<Resource>${escapeXml('/' + bucket + (key ? '/' + key : ''))}</Resource>` +
      `<RequestId>${escapeXml(requestId)}</RequestId>` +
      `</Error>\n`;

    if (status >= 500) {
      this.logger.error({ err: exception, requestId, code }, 'S3 5xx');
    }

    res.status(status);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('x-amz-request-id', requestId);
    res.send(xml);
  }
}

function mapToS3Shape(exception: unknown): { status: number; code: string; message: string } {
  if (exception instanceof S3Error) {
    return { status: exception.status, code: exception.code, message: exception.message };
  }
  if (exception instanceof HttpException) {
    return {
      status: exception.getStatus(),
      code: 'InternalError',
      message: exception.message,
    };
  }
  return { status: 500, code: 'InternalError', message: 'We encountered an internal error.' };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

### 1.6.2 Admin exception filter

```ts
// apps/backend/src/common/filters/admin-exception.filter.ts
import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import type { Request, Response } from 'express';

@Catch()
export class AdminExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AdminExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    if (req.openbucket?.kind !== 'admin') {
      throw exception;
    }

    const requestId = req.openbucket.requestId;

    if (exception instanceof ZodValidationException) {
      res.status(400).json({
        error: 'ValidationFailed',
        message: 'Request payload failed validation.',
        issues: exception.getZodError().issues,
        requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { error: body } : (body as Record<string, unknown>);
      res.status(status).json({ ...payload, requestId });
      return;
    }

    this.logger.error({ err: exception, requestId }, 'Admin 5xx');
    res.status(500).json({
      error: 'InternalError',
      message: 'An unexpected error occurred.',
      requestId,
    });
  }
}
```

The catch-all is a one-line last-resort filter that logs and returns `500` with no body, registered below both kind-specific filters so it only fires for requests the classifier left in an undefined state (theoretically unreachable; it's defence in depth).

### 1.6.3 Validation pipe

`ZodValidationPipe` from `nestjs-zod` is registered globally via `APP_PIPE`. DTOs derive from Zod schemas via `createZodDto`; this is documented in the per-route material the S3 and admin agents own. The pipe handles param/query/body validation uniformly and throws `ZodValidationException` on failure, which the admin filter (§1.6.2) maps to a 400 JSON response. For S3 routes, the S3 controller catches Zod errors at the boundary and re-throws as `InvalidArgument` etc. — that mapping is owned by the S3 agent [see §3].

## 1.7 Config — Zod-validated env

`@nestjs/config` runs the env through a Zod schema. Failure throws synchronously during `NestFactory.create`, before the listener is bound — the container exits with a clear stderr message and a non-zero exit code. No graceful "partial boot": refusal is the design.

```ts
// apps/backend/src/common/config/env.schema.ts
import { z } from 'zod';

const portNumber = z.coerce.number().int().min(1).max(65_535);

export const EnvSchema = z
  .object({
    // --- runtime ---
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: portNumber.default(9000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    // --- persistence ---
    DATA_DIR: z
      .string()
      .min(1, 'DATA_DIR must be set to a host-mounted directory')
      .refine((p) => !p.endsWith('/'), 'DATA_DIR must not have a trailing slash'),

    // --- admin auth ---
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900), // 15m
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).max(2_592_000).default(604_800), // 7d
    ADMIN_USERNAME: z.string().min(1).default('admin'),
    ADMIN_PASSWORD_HASH: z
      .string()
      .regex(/^\$argon2id\$/, 'ADMIN_PASSWORD_HASH must be an argon2id hash'),

    // --- s3 protocol ---
    ROOT_ACCESS_KEY_ID: z
      .string()
      .regex(/^[A-Z0-9]{16,32}$/, 'ROOT_ACCESS_KEY_ID must be 16-32 uppercase alphanumerics'),
    ROOT_SECRET_ACCESS_KEY: z
      .string()
      .min(32, 'ROOT_SECRET_ACCESS_KEY must be at least 32 characters'),
    OPENBUCKET_ENDPOINT: z
      .string()
      .regex(/^[a-z0-9.-]+$/, 'OPENBUCKET_ENDPOINT must be a DNS-safe hostname')
      .optional(),
    OPENBUCKET_REGION: z.string().default('us-east-1'),

    // --- limits ---
    MAX_OBJECT_SIZE_MB: z.coerce.number().int().positive().max(5_242_880).default(5_120_000), // 5 TiB
    MAX_MULTIPART_PARTS: z.coerce.number().int().positive().max(10_000).default(10_000),
    MULTIPART_TTL_HOURS: z.coerce.number().int().positive().default(24),

    // --- shutdown ---
    SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  })
  .strict();

export type Env = z.infer<typeof EnvSchema>;

/**
 * Used by ConfigModule.forRoot({ validate }). Throws on failure; Nest converts
 * the throw into a fatal boot error.
 */
export function loadEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    throw new Error('Refusing to boot: invalid environment.');
  }
  return result.data;
}
```

`AppConfigService` is a thin typed wrapper around `ConfigService<Env, true>` so the rest of the codebase consumes typed getters instead of string lookups:

```ts
// apps/backend/src/common/config/app-config.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly raw: ConfigService<Env, true>) {}

  get nodeEnv(): Env['NODE_ENV']        { return this.raw.get('NODE_ENV', { infer: true }); }
  get port(): number                    { return this.raw.get('PORT', { infer: true }); }
  get logLevel(): Env['LOG_LEVEL']      { return this.raw.get('LOG_LEVEL', { infer: true }); }
  get dataDir(): string                 { return this.raw.get('DATA_DIR', { infer: true }); }
  get jwtSecret(): string               { return this.raw.get('JWT_SECRET', { infer: true }); }
  get jwtAccessTtl(): number            { return this.raw.get('JWT_ACCESS_TTL_SECONDS', { infer: true }); }
  get jwtRefreshTtl(): number           { return this.raw.get('JWT_REFRESH_TTL_SECONDS', { infer: true }); }
  get adminUsername(): string           { return this.raw.get('ADMIN_USERNAME', { infer: true }); }
  get adminPasswordHash(): string       { return this.raw.get('ADMIN_PASSWORD_HASH', { infer: true }); }
  get rootAccessKeyId(): string         { return this.raw.get('ROOT_ACCESS_KEY_ID', { infer: true }); }
  get rootSecretAccessKey(): string     { return this.raw.get('ROOT_SECRET_ACCESS_KEY', { infer: true }); }
  get endpoint(): string | undefined    { return this.raw.get('OPENBUCKET_ENDPOINT', { infer: true }); }
  get region(): string                  { return this.raw.get('OPENBUCKET_REGION', { infer: true }); }
  get maxObjectSizeMb(): number         { return this.raw.get('MAX_OBJECT_SIZE_MB', { infer: true }); }
  get maxMultipartParts(): number       { return this.raw.get('MAX_MULTIPART_PARTS', { infer: true }); }
  get multipartTtlHours(): number       { return this.raw.get('MULTIPART_TTL_HOURS', { infer: true }); }
  get shutdownDrainMs(): number         { return this.raw.get('SHUTDOWN_DRAIN_MS', { infer: true }); }
}
```

The eight refuse-to-boot variables are: `DATA_DIR`, `JWT_SECRET`, `ROOT_ACCESS_KEY_ID`, `ROOT_SECRET_ACCESS_KEY`, `ADMIN_PASSWORD_HASH`, plus `ADMIN_USERNAME` (effectively required because it has no useful default beyond `admin`), `OPENBUCKET_REGION`, and `PORT`. Of these, only the first five lack defaults — missing any of them fails validation immediately.

## 1.8 Health and readiness

Two endpoints under the admin tree. They are deliberately *not* under `/api/admin/auth/*` and are exempt from the admin JWT guard — orchestrators (Docker, k8s, ECS) need to probe without credentials.

```ts
// apps/backend/src/admin/health/health.controller.ts
import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator'; // owned by §6; mark route as unauthenticated
import { MikroORM } from '@mikro-orm/core';
import { BlobStoreHealth } from '../../storage/blob-store.health';   // owned by §2
import { ShutdownState } from '../../common/shutdown-state.service'; // see §1.10

@Controller('api/admin')
export class HealthController {
  constructor(
    private readonly orm: MikroORM,
    private readonly blobs: BlobStoreHealth,
    private readonly shutdown: ShutdownState,
  ) {}

  /** Liveness — the process is alive and the event loop responds. */
  @Public()
  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  /** Readiness — the process can serve traffic right now. */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    if (this.shutdown.isShuttingDown) {
      throw new ServiceUnavailableException({ status: 'draining' });
    }

    // SQLite reachability — a trivial PRAGMA round-trip via the EM connection.
    try {
      await this.orm.em.getConnection().execute('SELECT 1');
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'db-unreachable' });
    }

    // Blob store directory writability (a stat on DATA_DIR).
    if (!(await this.blobs.canWrite())) {
      throw new ServiceUnavailableException({ status: 'storage-unwritable' });
    }

    return { status: 'ready' };
  }
}
```

`/api/admin/health` is the cheap liveness probe: it returns 200 as long as the event loop spins. `/api/admin/ready` is the readiness probe and checks (a) we are not in the SIGTERM drain window, (b) SQLite responds to a no-op query, (c) the blob store's data dir is writable. The actual implementations of `BlobStoreHealth` belong to the persistence agent [see §2]; this section requires only the interface.

## 1.9 Static SPA serving

The Angular admin app is built by the frontend agent and copied into `apps/backend/dist/spa/` during Docker build [see §5]. `SpaModule` exposes it under `/admin`, with `index.html` fallback so the Angular router handles deep links.

```ts
// apps/backend/src/spa/spa.module.ts
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      // dist/spa is populated at Docker build time from the Angular dist [see §5].
      rootPath: join(__dirname, '..', 'spa'),
      serveRoot: '/admin',
      exclude: ['/api/(.*)'],   // never let SPA fallback shadow the admin API
      serveStaticOptions: {
        index: 'index.html',
        fallthrough: true,
        // hashed assets are immutable; index.html is not.
        setHeaders: (res, path) => {
          if (path.endsWith('/index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else if (/\.[0-9a-f]{8,}\.(js|css|woff2?|png|svg|jpg|webp)$/i.test(path)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=300');
          }
        },
      },
    }),
  ],
})
export class SpaModule {}
```

Three points:

- `serveRoot: '/admin'` keeps the SPA off the bucket-name namespace at `/`. Without it, a bucket called `assets/index.html` would conflict with the SPA shell.
- `exclude: ['/api/(.*)']` is belt-and-braces — `AdminModule`'s controllers already register `/api/admin/*` routes, but the exclude ensures that even if a future bug shadows them, the API wins.
- The `setHeaders` callback gates browser caching: hashed bundles get a year of `immutable`; `index.html` gets `no-cache` so a redeploy is picked up on next page load.

`index.html` fallback for Angular router deep links is handled by `serve-static`'s `fallthrough` plus `ServeStaticModule`'s default rewrite. If a route under `/admin/...` does not match a file, `index.html` is served with status 200 and Angular's router renders the client-side route.

## 1.10 Graceful shutdown

A clean SIGTERM is the difference between zero-downtime deploys and corrupted multipart sessions. The strategy:

1. On `SIGTERM`, flip a `ShutdownState.isShuttingDown` flag so `/api/admin/ready` starts returning 503 (orchestrators drain traffic).
2. Tell the HTTP server to stop accepting new connections (`server.close()` callback resolves when in-flight requests finish).
3. Wait up to `SHUTDOWN_DRAIN_MS` (default 30 s) for in-flight requests to complete. The `ShutdownTrackerInterceptor` keeps a counter; when it hits zero we proceed immediately.
4. Cancel background tasks (lifecycle tick, multipart sweep — owned by the streaming agent [see §4]) by emitting on an `AbortController` they observe.
5. Close MikroORM (flush WAL, close better-sqlite3).
6. `process.exit(0)`. If step 3 times out, exit with a clear log line and code 1 — the orchestrator will restart us.

```ts
// apps/backend/src/common/shutdown-state.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownState {
  private _isShuttingDown = false;
  private _inFlight = 0;
  private readonly drained = new Set<() => void>();
  /** AbortSignal background workers observe; aborted when shutdown begins. */
  readonly abortController = new AbortController();

  get isShuttingDown(): boolean { return this._isShuttingDown; }
  get inFlight(): number        { return this._inFlight; }

  beginShutdown(): void {
    if (this._isShuttingDown) return;
    this._isShuttingDown = true;
    this.abortController.abort();
  }

  enter(): void { this._inFlight += 1; }
  leave(): void {
    this._inFlight = Math.max(0, this._inFlight - 1);
    if (this._inFlight === 0) {
      for (const resolve of this.drained) resolve();
      this.drained.clear();
    }
  }

  whenDrained(): Promise<void> {
    if (this._inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.drained.add(resolve));
  }
}
```

```ts
// apps/backend/src/common/interceptors/shutdown-tracker.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';

import { ShutdownState } from '../shutdown-state.service';

@Injectable()
export class ShutdownTrackerInterceptor implements NestInterceptor {
  constructor(private readonly state: ShutdownState) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    this.state.enter();
    return next.handle().pipe(finalize(() => this.state.leave()));
  }
}
```

```ts
// apps/backend/src/bootstrap/shutdown.ts
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Logger } from '@nestjs/common';

import { ShutdownState } from '../common/shutdown-state.service';
import { AppConfigService } from '../common/config/app-config.service';

interface ShutdownOptions { drainTimeoutMs: number }

export function installShutdownHandlers(app: INestApplication, _opts: ShutdownOptions): void {
  const logger = new Logger('Shutdown');
  const state = app.get(ShutdownState);
  const config = app.get(AppConfigService);
  const drainTimeoutMs = config.shutdownDrainMs;
  let shuttingDown = false;

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      logger.warn(`Received ${signal} again; forcing exit.`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.log(`Received ${signal}; beginning graceful shutdown.`);

    state.beginShutdown();   // /ready starts returning 503; bg workers see AbortSignal

    const server = app.getHttpServer() as Server;
    server.close((err) => {
      if (err) logger.error({ err }, 'HTTP server close error.');
    });

    // Race in-flight drain against the deadline.
    const drain = state.whenDrained();
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), drainTimeoutMs).unref(),
    );
    const outcome = await Promise.race([drain.then(() => 'drained' as const), timeout]);

    if (outcome === 'timeout') {
      logger.warn(
        `Drain deadline (${drainTimeoutMs}ms) elapsed with ${state.inFlight} in-flight requests; closing anyway.`,
      );
    } else {
      logger.log('All in-flight requests completed.');
    }

    try {
      await app.close();  // calls onModuleDestroy on every module — MikroORM closes here
      logger.log('Nest application closed cleanly.');
      process.exit(outcome === 'timeout' ? 1 : 0);
    } catch (err) {
      logger.error({ err }, 'Error during app.close().');
      process.exit(1);
    }
  }

  process.on('SIGTERM', (s) => void shutdown(s));
  process.on('SIGINT', (s) => void shutdown(s));
}
```

`ShutdownState` is provided by `CommonModule` (alongside the interceptor). Background tasks created by the streaming agent [see §4] inject `ShutdownState` and observe its `abortController.signal` — the shutdown wiring is here; the workers that listen are not.

MikroORM cleanup is triggered by `app.close()` via the `MikroOrmModule`'s `onApplicationShutdown` hook — no explicit call is needed in this file. Likewise, the `enableShutdownHooks(['SIGINT','SIGTERM'])` call in `main.ts` exists so that Nest also fires its own lifecycle hooks; we handle the signal ourselves above so we can run the drain logic *before* Nest tears modules down.
# 2. S3 Wire Protocol & SigV4 Authentication

This section specifies the S3 surface of OpenBucket end-to-end: how requests are
dispatched to the right handler, how SigV4 is verified for the three signing
variants we accept, how XML is parsed and serialized, how S3 errors are encoded,
and how every supported S3 operation maps onto an HTTP route. The reader is
assumed to have read [§1 — Architecture & Topology] and understands that a
classifier middleware (owned by the backend-architect agent) has already tagged
each request with `req.openbucket.kind`, `req.openbucket.bucket`, and
`req.openbucket.style` before this layer sees it.

The S3 controller tree lives under `apps/backend/src/s3/`. Every file path
below is absolute against that root.

---

## 2.1. Topology of the S3 controller tree

S3's URL grammar is *not* resource-shaped in a way that maps cleanly to one
controller per HTTP resource. The same path `/<bucket>` answers ten different
operations distinguished only by query strings (`?versioning`, `?cors`,
`?lifecycle`, `?tagging`, `?uploads`, …) and the same path `/<bucket>/<key>`
distinguishes single-PUT from multipart-part-upload by the presence of
`?uploadId=…&partNumber=…`. We therefore split the controllers **by resource
class** (service, bucket, object, multipart) and use NestJS's query/header
matchers plus a small `@OperationDispatcher` decorator to fan one HTTP route
out to many operation handlers.

```
apps/backend/src/s3/
  s3.module.ts
  controllers/
    service.controller.ts          // GET /  -> ListBuckets
    bucket.controller.ts           // /:bucket — all bucket-scope ops
    object.controller.ts           // /:bucket/:key(*) — all object-scope ops
    multipart.controller.ts        // multipart sub-operations
  sigv4/
    sigv4.guard.ts
    sigv4.verifier.ts
    canonical-request.ts
    presigned.ts
    key.service.ts                 // interface only; impl in persistence
  xml/
    xml.interceptor.ts
    xml.serializer.ts
    xml.parser.ts
  errors/
    s3-error.ts                    // abstract base + taxonomy
    s3-exception.filter.ts
  routing/
    route-resolver.ts              // virtual-host vs path-style
    operation.decorator.ts         // @S3Operation('PutObject', {...})
  pagination/
    continuation-token.ts
  cors/
    cors.controller.ts             // OPTIONS preflight per bucket
```

The S3 module is mounted last in `AppModule`'s controller list; the classifier
middleware [see §1] ensures requests under `/admin/*`, `/api/admin/*`, or the
SPA asset prefix never reach it. The S3 controllers are catch-all relative to
that exclusion.

### 2.1.1. Controller skeleton

```ts
// apps/backend/src/s3/controllers/object.controller.ts
import {
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SigV4Guard } from '../sigv4/sigv4.guard';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { XmlInterceptor } from '../xml/xml.interceptor';
import { S3Operation } from '../routing/operation.decorator';
import { RouteResolver } from '../routing/route-resolver';
import { ObjectService } from '../../domain/objects/object.service';
import { MultipartService } from '../../domain/multipart/multipart.service';

@Controller()
@UseGuards(SigV4Guard)
@UseFilters(S3ExceptionFilter)
@UseInterceptors(XmlInterceptor)
export class ObjectController {
  constructor(
    private readonly objects: ObjectService,
    private readonly multipart: MultipartService,
    private readonly routes: RouteResolver,
  ) {}

  // --- PUT family --------------------------------------------------------
  // Dispatches PutObject, UploadPart, CopyObject, UploadPartCopy,
  // PutObjectTagging, PutObjectAcl, PutObjectRetention, PutObjectLegalHold.
  @Put(':bucketOrKey/*')
  @Put(':bucketOrKey')
  async put(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if (q.uploadId !== undefined && q.partNumber !== undefined) {
      if (req.headers['x-amz-copy-source'] !== undefined) {
        return this.multipart.uploadPartCopy(req, res, bucket, key, q);
      }
      return this.multipart.uploadPart(req, res, bucket, key, q);
    }
    if ('tagging' in q)      return this.objects.putTagging(req, bucket, key);
    if ('acl' in q)          return this.objects.putAcl(req, bucket, key);
    if ('retention' in q)    return this.objects.putRetention(req, bucket, key);
    if ('legal-hold' in q)   return this.objects.putLegalHold(req, bucket, key);
    if (req.headers['x-amz-copy-source']) {
      return this.objects.copyObject(req, res, bucket, key);
    }
    return this.objects.putObject(req, res, bucket, key);
  }

  // --- GET family --------------------------------------------------------
  @Get(':bucketOrKey/*')
  @Get(':bucketOrKey')
  async get(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if ('tagging' in q)    return this.objects.getTagging(req, bucket, key);
    if ('acl' in q)        return this.objects.getAcl(req, bucket, key);
    if ('retention' in q)  return this.objects.getRetention(req, bucket, key);
    if ('legal-hold' in q) return this.objects.getLegalHold(req, bucket, key);
    if (q.uploadId !== undefined) {
      return this.multipart.listParts(req, bucket, key, q.uploadId);
    }
    return this.objects.getObject(req, res, bucket, key);
  }

  @Head(':bucketOrKey/*')
  @Head(':bucketOrKey')
  async head(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    return this.objects.headObject(req, res, bucket, key);
  }

  // --- POST family (multipart init/complete + browser-form PostObject) ---
  @Post(':bucketOrKey/*')
  @Post(':bucketOrKey')
  async post(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if ('uploads' in q)       return this.multipart.createUpload(req, res, bucket, key);
    if (q.uploadId)           return this.multipart.completeUpload(req, res, bucket, key, q.uploadId);
    if ('restore' in q)       return this.objects.restoreObject(req, bucket, key);
    if ('select' in q)        throw new NotImplementedError('SelectObjectContent');
    return this.objects.postObject(req, res, bucket, key); // browser form upload
  }

  // --- DELETE ------------------------------------------------------------
  @Delete(':bucketOrKey/*')
  @Delete(':bucketOrKey')
  async delete(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;
    if (q.uploadId !== undefined) {
      return this.multipart.abortUpload(req, res, bucket, key, q.uploadId);
    }
    if ('tagging' in q) return this.objects.deleteTagging(req, bucket, key);
    return this.objects.deleteObject(req, res, bucket, key);
  }
}
```

The `BucketController` is structured identically but switches on the
bucket-scope query flags (`?versioning`, `?cors`, `?lifecycle`, etc.) and
exposes `DELETE /:bucket` plus `POST /:bucket?delete` for bulk delete.

The `:bucketOrKey` parameter name is a deliberate decoy — its actual meaning
depends on the routing style and is resolved by `RouteResolver` [see §2.2],
not by Nest's path parser.

---

## 2.2. Virtual-host vs path-style routing

The classifier middleware (backend-architect's responsibility) attaches the
following structure to every request before it reaches a guard:

```ts
// apps/backend/src/common/openbucket-request.d.ts
declare module 'express-serve-static-core' {
  interface Request {
    openbucket: {
      kind: 's3' | 'admin' | 'spa';
      style: 'virtual-host' | 'path';
      bucket: string | null;       // null only for ListBuckets (GET /)
      keyRaw: string | null;       // raw, not URL-decoded; null for bucket-scope
      requestId: string;           // UUID v7
      receivedAt: number;          // Date.now() at first byte
    };
  }
}
```

`RouteResolver` consumes the classifier's output and returns the canonical
`(bucket, key)` pair to every controller handler. Controllers do not parse the
URL themselves — they ask the resolver.

```ts
// apps/backend/src/s3/routing/route-resolver.ts
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { InvalidBucketNameError } from '../errors/s3-error';

const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$/;

@Injectable()
export class RouteResolver {
  resolve(req: Request): { bucket: string; key: string } {
    const ob = req.openbucket;
    if (!ob || ob.kind !== 's3') {
      // Should never happen — classifier would have routed elsewhere.
      throw new InvalidBucketNameError('');
    }

    const bucket = ob.bucket;
    if (bucket === null) {
      // GET / (ListBuckets) — controllers that depend on a bucket should
      // never call resolve(); this guard catches programmer error.
      throw new InvalidBucketNameError('');
    }
    if (!BUCKET_NAME_RE.test(bucket) || bucket.includes('..')) {
      throw new InvalidBucketNameError(bucket);
    }

    // Object key is whatever path remained after stripping the bucket prefix
    // (path style) or the entire path minus the leading slash (virtual-host
    // style). The classifier has already done that split.
    const key = ob.keyRaw ?? '';

    // S3 keys are 1..1024 UTF-8 bytes. Empty key on an object route means
    // the URL didn't carry a key segment — the bucket-scope controller
    // should have matched instead. We reach here only for bucket routes;
    // returning '' is safe.
    return { bucket, key };
  }
}
```

The classifier guarantees these invariants by the time a request reaches the
guard:

1. Path style: `host` is the configured endpoint (or any non-bucket label).
   The first path segment is the bucket; everything after is the key.
2. Virtual-host style: `host` matches `<bucket>.<endpoint>`. The full path
   (minus leading `/`) is the key.
3. Either style: leading and trailing whitespace stripped from the bucket,
   percent-decoded once for the key.

Because the controllers consume `req.openbucket.bucket` / `keyRaw` directly,
they work identically under both styles — the route patterns
(`/:bucketOrKey/*` etc.) match against the URL Express sees, and the resolver
overrides what they mean.

---

## 2.3. XML request/response handling

### 2.3.1. Why `fast-xml-parser` v4

S3 uses XML for a handful of small documents on the request side
(`CreateBucketConfiguration`, `Tagging`, `CompleteMultipartUpload`, `Delete`,
lifecycle, CORS, versioning, encryption, object-lock) and for *every*
non-empty response. The parser must:

- Parse with attributes (lifecycle rules use `<Filter>` with attributes).
- Preserve order of repeated elements (`<Part>` inside
  `CompleteMultipartUpload`).
- Refuse XXE — no external entity resolution, no DOCTYPE.
- Reject documents over a small ceiling — S3 metadata bodies are at most a
  few tens of KB; anything larger is an attack.

`fast-xml-parser@4.4.x` satisfies all four. It's pure JS (no native build),
runs comfortably in the Node event loop, and has explicit options for
attribute parsing, array hints, and entity processing. Alternatives
considered:

- `xml2js` — slower, weak XXE story, awkward attribute handling.
- `libxmljs2` — native binding, alpine/musl build friction. Not worth it.

### 2.3.2. XmlInterceptor

```ts
// apps/backend/src/s3/xml/xml.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';
import { XmlParser } from './xml.parser';
import { XmlSerializer } from './xml.serializer';
import { MalformedXMLError } from '../errors/s3-error';

const MAX_XML_BYTES = 256 * 1024; // 256 KB; any S3 config doc fits well inside.

const XML_REQUEST_OPS = new Set([
  'CreateBucket',            // <CreateBucketConfiguration>
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
  'PutBucketVersioning',
  'PutBucketTagging',
  'PutBucketReplication',
  'PutBucketEncryption',
  'PutBucketAcl',
  'PutBucketPolicy',         // JSON, not XML — skipped by op-name match
  'PutObjectLockConfiguration',
  'PutObjectTagging',
  'PutObjectRetention',
  'PutObjectLegalHold',
  'CompleteMultipartUpload',
  'DeleteObjects',           // <Delete><Object>... — POST ?delete
]);

@Injectable()
export class XmlInterceptor implements NestInterceptor {
  constructor(
    private readonly parser: XmlParser,
    private readonly serializer: XmlSerializer,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const op = (req as any).openbucket?.operation as string | undefined;
    const needsXmlBody =
      op !== undefined &&
      XML_REQUEST_OPS.has(op) &&
      req.method !== 'GET' &&
      req.method !== 'HEAD';

    const inbound: Observable<void> = needsXmlBody
      ? from(this.readXmlBody(req)).pipe(
          map((parsed) => {
            (req as any).xmlBody = parsed;
          }),
        )
      : of(undefined);

    return inbound.pipe(
      mergeMap(() => next.handle()),
      map((value) => {
        if (value === undefined || value === null) return value;
        if (Buffer.isBuffer(value)) return value;        // raw object bytes
        if (typeof value === 'string') return value;     // already serialized
        if ((value as { __raw?: boolean }).__raw) return value;

        // POJO returned by a handler -> XML envelope.
        const rootName = (value as { __root?: string }).__root ?? 'Result';
        const body = this.serializer.serialize(rootName, value);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
        return body;
      }),
    );
  }

  private async readXmlBody(req: Request): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      req.on('data', (c: Buffer) => {
        received += c.length;
        if (received > MAX_XML_BYTES) {
          req.destroy();
          reject(new MalformedXMLError('XML body too large'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length === 0) {
          resolve(undefined);
          return;
        }
        try {
          resolve(this.parser.parse(raw));
        } catch (e) {
          reject(new MalformedXMLError((e as Error).message));
        }
      });
      req.on('error', reject);
    });
  }
}
```

### 2.3.3. Parser

```ts
// apps/backend/src/s3/xml/xml.parser.ts
import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { MalformedXMLError } from '../errors/s3-error';

@Injectable()
export class XmlParser {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    processEntities: false,        // XXE defence: no entity processing.
    htmlEntities: false,
    allowBooleanAttributes: false,
    // Hint arrays for elements that S3 documents repeat:
    isArray: (name) =>
      [
        'Part',
        'Object',
        'Rule',
        'CORSRule',
        'AllowedOrigin',
        'AllowedMethod',
        'AllowedHeader',
        'ExposeHeader',
        'Tag',
        'Grant',
        'NoncurrentVersionTransition',
        'Transition',
      ].includes(name),
  });

  parse(xml: string): unknown {
    // Cheap pre-check: reject any DOCTYPE outright.
    if (/<!DOCTYPE/i.test(xml)) {
      throw new MalformedXMLError('DOCTYPE not allowed');
    }
    const parsed = this.parser.parse(xml);
    if (!parsed || typeof parsed !== 'object') {
      throw new MalformedXMLError('expected root element');
    }
    return parsed;
  }
}
```

### 2.3.4. Serializer

```ts
// apps/backend/src/s3/xml/xml.serializer.ts
import { Injectable } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';

const XML_NS = 'http://s3.amazonaws.com/doc/2006-03-01/';

@Injectable()
export class XmlSerializer {
  private readonly builder = new XMLBuilder({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    format: false,                    // S3 wire format isn't pretty-printed.
    suppressEmptyNode: false,
    processEntities: true,
    suppressBooleanAttributes: false,
  });

  serialize(rootName: string, value: unknown): string {
    // Strip internal hints before building.
    const cleaned = this.stripInternals(value);
    const doc = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      [rootName]: {
        '@_xmlns': XML_NS,
        ...(cleaned as object),
      },
    };
    return this.builder.build(doc);
  }

  private stripInternals(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.stripInternals(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === '__root' || k === '__raw') continue;
        out[k] = this.stripInternals(val);
      }
      return out;
    }
    return v;
  }
}
```

Handlers either:

- return a POJO with `__root: 'ListBucketResult'` (or whichever AWS root
  element name applies) — the interceptor serializes it and sets
  `Content-Type: application/xml`; or
- return a `Buffer` or `{ __raw: true }` envelope for binary object payloads
  and 200/204 responses that carry no body — the interceptor passes through.

For `GET /<bucket>/<key>` the handler writes directly to the `Response`
stream via the streaming agent's pipe primitive [see §3] and returns
`undefined`; the interceptor short-circuits.

---

## 2.4. SigV4 verification

### 2.4.1. The three signing variants we accept

| Variant | Carrier | Notes |
|---|---|---|
| Header-based | `Authorization: AWS4-HMAC-SHA256 …` + `X-Amz-Date` + `X-Amz-Content-Sha256` | The common case. SDK default for short bodies. |
| Presigned URL | `X-Amz-Algorithm=AWS4-HMAC-SHA256` + `X-Amz-Signature=…` query params | Used for browser uploads and CLI `presign`. |
| Chunked-payload | `Authorization: AWS4-HMAC-SHA256 …` + `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` | **Rejected in v1 — see §2.4.6.** |

Trailing-checksum (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`) is *accepted* — the
seed signature is verified normally; the trailer is validated only as a
checksum, not as auth.

### 2.4.2. KeyService — the persistence boundary

The guard never touches MikroORM. It depends on the abstract:

```ts
// apps/backend/src/s3/sigv4/key.service.ts
export interface AccessKey {
  accessKeyId: string;
  secretAccessKey: string;
  disabled: boolean;
}

export abstract class KeyService {
  /**
   * Resolve an access key id to its secret.
   *
   * Contract:
   *  - Returns null if the access key id is unknown OR is disabled.
   *  - MUST be constant-time across all known/unknown branches at the
   *    *caller's* level — i.e., it is acceptable for this method to return
   *    quickly with null; the SigV4Guard wraps the comparison in
   *    timingSafeEqual to prevent timing leakage of the secret itself.
   *  - The implementation MAY cache results in memory for up to 60 s.
   *  - Implementation belongs to the persistence agent (see §4).
   */
  abstract getSecret(accessKeyId: string): Promise<AccessKey | null>;
}
```

The persistence agent provides the concrete `SqliteKeyService` implementing
this interface; the S3 module imports the abstract token only.

### 2.4.3. SigV4Guard

```ts
// apps/backend/src/s3/sigv4/sigv4.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { KeyService } from './key.service';
import {
  AccessDeniedError,
  InvalidArgumentError,
  RequestTimeTooSkewedError,
  SignatureDoesNotMatchError,
} from '../errors/s3-error';
import { Sigv4Verifier } from './sigv4.verifier';
import { verifyPresigned } from './presigned';

const MAX_SKEW_MS = 15 * 60 * 1000;        // AWS default ±15 minutes.
const STREAMING_SHA = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';

@Injectable()
export class SigV4Guard implements CanActivate {
  constructor(
    private readonly keys: KeyService,
    private readonly verifier: Sigv4Verifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Reject chunked-upload signing per §2.4.6.
    const contentSha = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
    if (contentSha === STREAMING_SHA) {
      throw new InvalidArgumentError(
        'STREAMING-AWS4-HMAC-SHA256-PAYLOAD is not supported. ' +
          'Set x-amz-content-sha256: UNSIGNED-PAYLOAD instead.',
        'x-amz-content-sha256',
        STREAMING_SHA,
      );
    }

    const query = req.query as Record<string, string | undefined>;
    if (query['X-Amz-Signature']) {
      return this.checkPresigned(req);
    }
    return this.checkHeader(req);
  }

  // -------- Header-based ------------------------------------------------
  private async checkHeader(req: Request): Promise<boolean> {
    const authz = req.headers['authorization'];
    if (typeof authz !== 'string' || !authz.startsWith('AWS4-HMAC-SHA256 ')) {
      throw new AccessDeniedError('missing or unsupported Authorization header');
    }
    const amzDate = req.headers['x-amz-date'];
    if (typeof amzDate !== 'string') {
      throw new AccessDeniedError('missing X-Amz-Date');
    }
    this.checkSkew(amzDate);

    const parsed = this.parseAuthorization(authz);
    const key = await this.keys.getSecret(parsed.accessKeyId);
    if (!key) throw new SignatureDoesNotMatchError();

    const expected = await this.verifier.signatureForHeaderRequest({
      req,
      secretAccessKey: key.secretAccessKey,
      credentialScope: parsed.credentialScope,
      signedHeaders: parsed.signedHeaders,
      amzDate,
    });

    if (!this.verifier.constantTimeEquals(expected, parsed.signature)) {
      throw new SignatureDoesNotMatchError();
    }

    (req as any).openbucket.accessKeyId = parsed.accessKeyId;
    return true;
  }

  // -------- Presigned --------------------------------------------------
  private async checkPresigned(req: Request): Promise<boolean> {
    const ok = await verifyPresigned(req, this.keys, this.verifier);
    if (!ok) throw new SignatureDoesNotMatchError();
    return true;
  }

  // -------- Helpers ----------------------------------------------------
  private parseAuthorization(authz: string): {
    accessKeyId: string;
    credentialScope: string;        // e.g. 20260520/us-east-1/s3/aws4_request
    signedHeaders: string[];
    signature: string;
  } {
    // Format: AWS4-HMAC-SHA256 Credential=AKID/20260520/us-east-1/s3/aws4_request,
    //                          SignedHeaders=host;x-amz-content-sha256;x-amz-date,
    //                          Signature=hex…
    const body = authz.slice('AWS4-HMAC-SHA256 '.length);
    const parts: Record<string, string> = {};
    for (const seg of body.split(',')) {
      const [k, v] = seg.trim().split('=');
      if (k && v) parts[k] = v;
    }
    const cred = parts['Credential'];
    if (!cred) throw new AccessDeniedError('missing Credential');
    const credParts = cred.split('/');
    if (credParts.length !== 5) throw new AccessDeniedError('malformed Credential');
    const [accessKeyId, date, region, service, terminator] = credParts;
    if (service !== 's3' || terminator !== 'aws4_request') {
      throw new AccessDeniedError('unexpected credential scope');
    }
    return {
      accessKeyId,
      credentialScope: `${date}/${region}/${service}/${terminator}`,
      signedHeaders: (parts['SignedHeaders'] ?? '').split(';').filter(Boolean),
      signature: parts['Signature'] ?? '',
    };
  }

  private checkSkew(amzDate: string): void {
    // amzDate is ISO basic: YYYYMMDDTHHMMSSZ
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
    if (!m) throw new AccessDeniedError('malformed X-Amz-Date');
    const t = Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6]),
    );
    if (Math.abs(Date.now() - t) > MAX_SKEW_MS) {
      throw new RequestTimeTooSkewedError(t);
    }
  }
}
```

### 2.4.4. Verifier — canonical request reconstruction

```ts
// apps/backend/src/s3/sigv4/sigv4.verifier.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { Request } from 'express';
import { buildCanonicalRequest } from './canonical-request';

@Injectable()
export class Sigv4Verifier {
  /**
   * Reconstruct the canonical request, derive the signing key, and produce
   * the hex signature the client *should* have sent.
   */
  async signatureForHeaderRequest(args: {
    req: Request;
    secretAccessKey: string;
    credentialScope: string;        // 20260520/us-east-1/s3/aws4_request
    signedHeaders: string[];
    amzDate: string;
  }): Promise<string> {
    const { req, secretAccessKey, credentialScope, signedHeaders, amzDate } = args;

    // 1. Payload hash: SDKs send either the body's sha256 in lowercase hex,
    //    or the literal string 'UNSIGNED-PAYLOAD'. The header is part of
    //    the SignedHeaders list, so its value participates in the canonical
    //    request verbatim — we do NOT recompute over the body.
    const payloadHash =
      (req.headers['x-amz-content-sha256'] as string | undefined) ?? 'UNSIGNED-PAYLOAD';

    // 2. Canonical request.
    const canonical = buildCanonicalRequest({
      method: req.method,
      pathname: this.originalPath(req),
      query: this.queryStringForCanonical(req),
      headers: req.headers as Record<string, string | string[] | undefined>,
      signedHeaders,
      payloadHash,
    });

    const hashedCanonical = sha256Hex(canonical);

    // 3. String to sign.
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      hashedCanonical,
    ].join('\n');

    // 4. Derive signing key. scope = date/region/service/aws4_request
    const [date, region, service] = credentialScope.split('/');
    const kDate = hmac(`AWS4${secretAccessKey}`, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');

    return hmacHex(kSigning, stringToSign);
  }

  constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  private originalPath(req: Request): string {
    // Express has already URL-decoded once. SigV4 wants the *path before*
    // application/x-www-form-urlencoded query splitting but with the path
    // segment URL-encoded per RFC 3986 (twice for S3 V4 — but S3 is the
    // exception that uses single-encoding).
    const u = new URL(`http://h${req.originalUrl}`);
    return u.pathname;
  }

  private queryStringForCanonical(req: Request): string {
    const u = new URL(`http://h${req.originalUrl}`);
    return u.search.startsWith('?') ? u.search.slice(1) : u.search;
  }
}

function sha256Hex(s: string | Buffer): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function hmacHex(key: Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}
```

### 2.4.5. Canonical request builder

```ts
// apps/backend/src/s3/sigv4/canonical-request.ts
export interface CanonicalRequestInput {
  method: string;
  pathname: string;                                 // already URL-decoded once
  query: string;                                    // raw query, no leading '?'
  headers: Record<string, string | string[] | undefined>;
  signedHeaders: string[];                          // lowercase, alpha-sorted
  payloadHash: string;
}

export function buildCanonicalRequest(c: CanonicalRequestInput): string {
  // 1. CanonicalURI: S3 uses single-pass URI encoding of each path segment.
  const canonicalUri = c.pathname
    .split('/')
    .map((seg) => awsUriEncode(seg, false))
    .join('/');

  // 2. CanonicalQueryString: sort by key, then by value; URI-encode both.
  const canonicalQuery = canonicaliseQuery(c.query);

  // 3. CanonicalHeaders: each signed header, lower-cased name, trimmed value,
  //    sequential whitespace collapsed, terminated with '\n'.
  const headerLines: string[] = [];
  for (const name of c.signedHeaders) {
    const raw = c.headers[name];
    const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
    const collapsed = value.trim().replace(/\s+/g, ' ');
    headerLines.push(`${name.toLowerCase()}:${collapsed}\n`);
  }

  const signedHeadersLine = c.signedHeaders.map((h) => h.toLowerCase()).join(';');

  return [
    c.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    headerLines.join(''),
    signedHeadersLine,
    c.payloadHash,
  ].join('\n');
}

function canonicaliseQuery(q: string): string {
  if (!q) return '';
  const params: Array<[string, string]> = [];
  for (const segment of q.split('&')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    const k = eq === -1 ? segment : segment.slice(0, eq);
    const v = eq === -1 ? '' : segment.slice(eq + 1);
    // Per SigV4, the query string is already URL-encoded in the URL. We
    // decode then re-encode to normalise.
    params.push([awsUriEncode(decodeURIComponent(k), true),
                 awsUriEncode(decodeURIComponent(v), true)]);
  }
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return params.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * AWS-flavoured RFC 3986: unreserved = ALPHA / DIGIT / '-' / '.' / '_' / '~'.
 * Slashes are preserved in path segments only when `encodeSlash === false`.
 */
function awsUriEncode(input: string, encodeSlash: boolean): string {
  const out: string[] = [];
  for (const byte of Buffer.from(input, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (
      (byte >= 0x30 && byte <= 0x39) ||  // 0-9
      (byte >= 0x41 && byte <= 0x5a) ||  // A-Z
      (byte >= 0x61 && byte <= 0x7a) ||  // a-z
      c === '-' || c === '_' || c === '.' || c === '~'
    ) {
      out.push(c);
    } else if (c === '/' && !encodeSlash) {
      out.push('/');
    } else {
      out.push('%' + byte.toString(16).toUpperCase().padStart(2, '0'));
    }
  }
  return out.join('');
}
```

The library `aws4` is *also* on the dependency list — we use it as a
cross-check in tests (sign with `aws4.sign`, verify with our verifier, and
vice-versa). In the hot path we use our own implementation because `aws4`'s
API is signing-oriented and inverting it through string-comparison would be
fragile.

### 2.4.6. Chunked-upload rejection (decision)

The streaming variant `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` requires the
server to verify a fresh HMAC for every 8 KiB chunk inside the request body,
each chained to the previous chunk's signature. It is genuinely hostile to
implement on top of Node streams because the chunk boundary is *in the wire
format*, not in `IncomingMessage` chunk events — we'd have to buffer-and-scan
for the `<size>;chunk-signature=…\r\n` framing on every `data` event. The
gain over `UNSIGNED-PAYLOAD` (or even better, `STREAMING-UNSIGNED-PAYLOAD-TRAILER`
with a SHA-256 trailer) is negligible: in both cases the connection-level
authentication is already established by the seed signature.

**Decision for v1: reject.** The guard returns:

```
HTTP/1.1 400 Bad Request
Content-Type: application/xml

<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>InvalidArgument</Code>
  <Message>STREAMING-AWS4-HMAC-SHA256-PAYLOAD is not supported. Set x-amz-content-sha256: UNSIGNED-PAYLOAD instead.</Message>
  <ArgumentName>x-amz-content-sha256</ArgumentName>
  <ArgumentValue>STREAMING-AWS4-HMAC-SHA256-PAYLOAD</ArgumentValue>
  <Resource>/bucket/key</Resource>
  <RequestId>...</RequestId>
</Error>
```

The AWS SDKs (JS v3, Python boto3, Go v2, Java v2) all honour the
`disablePayloadSigning` / `payloadSigningEnabled=false` flag and fall back to
`UNSIGNED-PAYLOAD`. The `aws s3 cp` CLI uses chunked signing by default; the
documented workaround is `--no-payload-signing` (or `s3.payload_signing_enabled = false`
in `~/.aws/config`). Both will be called out in the OpenBucket compatibility
notes section of the README. Re-enabling streaming signing is left to a v2
ticket — see ARCHITECTURE.md §11.

---

## 2.5. Presigned URL verification

A presigned URL carries every signing input in the query string:

```
GET /my-bucket/my-key
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=AKID%2F20260520%2Fus-east-1%2Fs3%2Faws4_request
  &X-Amz-Date=20260520T120000Z
  &X-Amz-Expires=900
  &X-Amz-SignedHeaders=host
  &X-Amz-Signature=…hex…
```

The verification differs from header-based in three ways:

1. **`X-Amz-Signature` is the field to verify** — `Authorization` is absent.
2. **Expiry is explicit.** `X-Amz-Expires` is seconds (1..604800). The check
   is `now ∈ [X-Amz-Date, X-Amz-Date + X-Amz-Expires]` — the ±15 min skew
   window applies only to the start, not the end.
3. **`X-Amz-Signature` itself is excluded from the canonical query string.**
   Every other `X-Amz-*` query param is included.

```ts
// apps/backend/src/s3/sigv4/presigned.ts
import type { Request } from 'express';
import { KeyService } from './key.service';
import { Sigv4Verifier } from './sigv4.verifier';
import {
  AccessDeniedError,
  InvalidArgumentError,
  RequestTimeTooSkewedError,
} from '../errors/s3-error';
import { buildCanonicalRequest } from './canonical-request';
import * as crypto from 'node:crypto';

const MAX_EXPIRES = 7 * 24 * 60 * 60;       // AWS: max 7 days.
const MAX_SKEW_MS = 15 * 60 * 1000;

export async function verifyPresigned(
  req: Request,
  keys: KeyService,
  verifier: Sigv4Verifier,
): Promise<boolean> {
  const q = req.query as Record<string, string | undefined>;

  const algorithm = q['X-Amz-Algorithm'];
  if (algorithm !== 'AWS4-HMAC-SHA256') {
    throw new InvalidArgumentError('unsupported algorithm', 'X-Amz-Algorithm', algorithm ?? '');
  }

  const credential = q['X-Amz-Credential'];
  const amzDate = q['X-Amz-Date'];
  const expiresStr = q['X-Amz-Expires'];
  const signedHeadersStr = q['X-Amz-SignedHeaders'];
  const presentedSig = q['X-Amz-Signature'];

  if (!credential || !amzDate || !expiresStr || !signedHeadersStr || !presentedSig) {
    throw new AccessDeniedError('missing presigned URL parameter');
  }

  const expires = Number.parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || expires < 1 || expires > MAX_EXPIRES) {
    throw new InvalidArgumentError('X-Amz-Expires out of range', 'X-Amz-Expires', expiresStr);
  }

  const start = parseAmzDate(amzDate);
  const now = Date.now();
  if (start - MAX_SKEW_MS > now) {
    throw new RequestTimeTooSkewedError(start);
  }
  if (now > start + expires * 1000) {
    // AWS calls this AccessDenied with Message="Request has expired".
    throw new AccessDeniedError('Request has expired');
  }

  const [accessKeyId, date, region, service, terminator] = credential.split('/');
  if (service !== 's3' || terminator !== 'aws4_request') {
    throw new AccessDeniedError('unexpected credential scope');
  }
  const credentialScope = `${date}/${region}/${service}/${terminator}`;

  const key = await keys.getSecret(accessKeyId);
  if (!key) {
    // Defer to a generic SignatureDoesNotMatch — do not leak whether the
    // key id is known.
    return false;
  }

  // Strip X-Amz-Signature from the canonical query.
  const queryWithoutSig = stripParam(req.originalUrl, 'X-Amz-Signature');
  const signedHeaders = signedHeadersStr.split(';').map((s) => s.toLowerCase());

  const canonical = buildCanonicalRequest({
    method: req.method,
    pathname: new URL(`http://h${req.originalUrl}`).pathname,
    query: queryWithoutSig,
    headers: req.headers as Record<string, string | string[] | undefined>,
    signedHeaders,
    payloadHash: 'UNSIGNED-PAYLOAD',
  });

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');

  const kDate    = crypto.createHmac('sha256', `AWS4${key.secretAccessKey}`).update(date).digest();
  const kRegion  = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const expected = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  if (!verifier.constantTimeEquals(expected, presentedSig)) {
    return false;
  }
  (req as any).openbucket.accessKeyId = accessKeyId;
  return true;
}

function parseAmzDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new AccessDeniedError('malformed X-Amz-Date');
  return Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6]),
  );
}

function stripParam(url: string, name: string): string {
  const u = new URL(`http://h${url}`);
  u.searchParams.delete(name);
  const q = u.search.startsWith('?') ? u.search.slice(1) : u.search;
  return q;
}
```

A presigned `PUT` can be uploaded with an empty `Authorization` header and
arbitrary body bytes; the seed signature already binds the request method,
URL, and `host` header. We do not verify any payload hash on presigned PUTs
unless the client opted-in by including `X-Amz-Content-Sha256` in the
SignedHeaders list — in which case the verifier picks it up like any other
signed header.

---

## 2.6. S3 error taxonomy

All errors thrown inside the S3 controller tree extend `S3Error`. The base
class captures the four pieces of an AWS error: code, message, HTTP status,
and a place for the resource and request id to be injected by the filter.

```ts
// apps/backend/src/s3/errors/s3-error.ts
export abstract class S3Error extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  resource?: string;
  requestId?: string;

  /** Optional AWS-specific extra fields (rendered as elements). */
  extra: Record<string, string | number | undefined> = {};

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// -- 400 --------------------------------------------------------------
export class InvalidBucketNameError extends S3Error {
  readonly code = 'InvalidBucketName';
  readonly httpStatus = 400;
  constructor(bucket: string) {
    super(`The specified bucket is not valid: ${bucket}`);
    this.extra.BucketName = bucket;
  }
}
export class InvalidArgumentError extends S3Error {
  readonly code = 'InvalidArgument';
  readonly httpStatus = 400;
  constructor(message: string, argName?: string, argValue?: string) {
    super(message);
    if (argName !== undefined)  this.extra.ArgumentName = argName;
    if (argValue !== undefined) this.extra.ArgumentValue = argValue;
  }
}
export class MalformedXMLError extends S3Error {
  readonly code = 'MalformedXML';
  readonly httpStatus = 400;
  constructor(detail = 'The XML you provided was not well-formed') {
    super(detail);
  }
}
export class InvalidPartError extends S3Error {
  readonly code = 'InvalidPart';
  readonly httpStatus = 400;
  constructor(partNumber?: number) {
    super('One or more of the specified parts could not be found.');
    if (partNumber !== undefined) this.extra.PartNumber = partNumber;
  }
}
export class InvalidPartOrderError extends S3Error {
  readonly code = 'InvalidPartOrder';
  readonly httpStatus = 400;
  constructor() {
    super('The list of parts was not in ascending order.');
  }
}
export class InvalidRequestError extends S3Error {
  readonly code = 'InvalidRequest';
  readonly httpStatus = 400;
}
export class EntityTooSmallError extends S3Error {
  readonly code = 'EntityTooSmall';
  readonly httpStatus = 400;
  constructor() {
    super('Your proposed upload is smaller than the minimum allowed object size.');
  }
}
export class IncompleteBodyError extends S3Error {
  readonly code = 'IncompleteBody';
  readonly httpStatus = 400;
}
export class MissingContentLengthError extends S3Error {
  readonly code = 'MissingContentLength';
  readonly httpStatus = 411;
}
export class RequestTimeTooSkewedError extends S3Error {
  readonly code = 'RequestTimeTooSkewed';
  readonly httpStatus = 403;
  constructor(serverTime: number) {
    super('The difference between the request time and the current time is too large.');
    this.extra.ServerTime = new Date(serverTime).toISOString();
    this.extra.RequestTime = new Date().toISOString();
  }
}

// -- 403 --------------------------------------------------------------
export class AccessDeniedError extends S3Error {
  readonly code = 'AccessDenied';
  readonly httpStatus = 403;
  constructor(message = 'Access Denied') { super(message); }
}
export class SignatureDoesNotMatchError extends S3Error {
  readonly code = 'SignatureDoesNotMatch';
  readonly httpStatus = 403;
  constructor() {
    super(
      'The request signature we calculated does not match the signature you provided. ' +
      'Check your key and signing method.',
    );
  }
}

// -- 404 --------------------------------------------------------------
export class NoSuchBucketError extends S3Error {
  readonly code = 'NoSuchBucket';
  readonly httpStatus = 404;
  constructor(bucket: string) {
    super('The specified bucket does not exist');
    this.extra.BucketName = bucket;
  }
}
export class NoSuchKeyError extends S3Error {
  readonly code = 'NoSuchKey';
  readonly httpStatus = 404;
  constructor(key: string) {
    super('The specified key does not exist.');
    this.extra.Key = key;
  }
}
export class NoSuchUploadError extends S3Error {
  readonly code = 'NoSuchUpload';
  readonly httpStatus = 404;
  constructor() { super('The specified multipart upload does not exist.'); }
}
export class NoSuchVersionError extends S3Error {
  readonly code = 'NoSuchVersion';
  readonly httpStatus = 404;
}
export class NoSuchCORSConfigurationError extends S3Error {
  readonly code = 'NoSuchCORSConfiguration';
  readonly httpStatus = 404;
}
export class NoSuchLifecycleConfigurationError extends S3Error {
  readonly code = 'NoSuchLifecycleConfiguration';
  readonly httpStatus = 404;
}
export class NoSuchBucketPolicyError extends S3Error {
  readonly code = 'NoSuchBucketPolicy';
  readonly httpStatus = 404;
}
export class NoSuchTagSetError extends S3Error {
  readonly code = 'NoSuchTagSet';
  readonly httpStatus = 404;
}

// -- 409 --------------------------------------------------------------
export class BucketAlreadyExistsError extends S3Error {
  readonly code = 'BucketAlreadyExists';
  readonly httpStatus = 409;
}
export class BucketAlreadyOwnedByYouError extends S3Error {
  readonly code = 'BucketAlreadyOwnedByYou';
  readonly httpStatus = 409;
}
export class BucketNotEmptyError extends S3Error {
  readonly code = 'BucketNotEmpty';
  readonly httpStatus = 409;
}
export class InvalidBucketStateError extends S3Error {
  readonly code = 'InvalidBucketState';
  readonly httpStatus = 409;
}
export class OperationAbortedError extends S3Error {
  readonly code = 'OperationAborted';
  readonly httpStatus = 409;
}

// -- 411 / 412 --------------------------------------------------------
export class PreconditionFailedError extends S3Error {
  readonly code = 'PreconditionFailed';
  readonly httpStatus = 412;
}

// -- 413 / 416 --------------------------------------------------------
export class EntityTooLargeError extends S3Error {
  readonly code = 'EntityTooLarge';
  readonly httpStatus = 413;
  constructor(proposed: number, max: number) {
    super('Your proposed upload exceeds the maximum allowed object size.');
    this.extra.ProposedSize = proposed;
    this.extra.MaxSizeAllowed = max;
  }
}
export class InvalidRangeError extends S3Error {
  readonly code = 'InvalidRange';
  readonly httpStatus = 416;
}

// -- 501 --------------------------------------------------------------
export class NotImplementedError extends S3Error {
  readonly code = 'NotImplemented';
  readonly httpStatus = 501;
  constructor(op: string) {
    super(`The ${op} operation is not implemented by OpenBucket.`);
    this.extra.Operation = op;
  }
}

// -- 503 --------------------------------------------------------------
export class ServiceUnavailableError extends S3Error {
  readonly code = 'ServiceUnavailable';
  readonly httpStatus = 503;
}
export class SlowDownError extends S3Error {
  readonly code = 'SlowDown';
  readonly httpStatus = 503;
}

// -- 500 --------------------------------------------------------------
export class InternalError extends S3Error {
  readonly code = 'InternalError';
  readonly httpStatus = 500;
  constructor() {
    super('We encountered an internal error. Please try again.');
  }
}
```

---

## 2.7. The S3 XML exception filter

The backend-architect agent provides the boilerplate that registers this
filter on the S3 controller tree and excludes the admin tree from it. This
section provides the body.

```ts
// apps/backend/src/s3/errors/s3-exception.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { XMLBuilder } from 'fast-xml-parser';
import { InternalError, S3Error } from './s3-error';

const builder = new XMLBuilder({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: true,
  processEntities: true,
});

@Catch()
export class S3ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(S3ExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const err = this.normalise(exception);
    const requestId = (req as any).openbucket?.requestId ?? 'unknown';
    const resource = this.resourceFor(req);

    if (err.httpStatus >= 500) {
      this.logger.error(
        { code: err.code, requestId, message: err.message, stack: (exception as Error)?.stack },
        's3 internal error',
      );
    } else {
      this.logger.debug(
        { code: err.code, requestId, message: err.message },
        's3 client error',
      );
    }

    const body = builder.build({
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      Error: {
        Code: err.code,
        Message: err.message,
        ...err.extra,
        Resource: resource,
        RequestId: requestId,
        HostId: requestId,                     // we have no separate host id
      },
    });

    if (res.headersSent) {
      // The handler began streaming before the error; we can only abort.
      res.destroy(err);
      return;
    }

    res.status(err.httpStatus);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('x-amz-request-id', requestId);
    res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));

    // HEAD must not write a body, even on error — AWS parity.
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  }

  private normalise(exception: unknown): S3Error {
    if (exception instanceof S3Error) return exception;
    if (exception instanceof HttpException) {
      // Convert Nest 404/405/etc. into S3-shaped errors.
      const status = exception.getStatus();
      const wrapped = new InternalError();
      (wrapped as { httpStatus: number }).httpStatus = status;
      (wrapped as { code: string }).code =
        status === 405 ? 'MethodNotAllowed' :
        status === 404 ? 'NoSuchKey' :
        'InternalError';
      (wrapped as { message: string }).message =
        (exception.getResponse() as { message?: string })?.message ?? exception.message;
      return wrapped as S3Error;
    }
    return new InternalError();
  }

  private resourceFor(req: Request): string {
    const ob = (req as any).openbucket;
    if (!ob) return req.originalUrl;
    if (ob.bucket && ob.keyRaw) return `/${ob.bucket}/${ob.keyRaw}`;
    if (ob.bucket) return `/${ob.bucket}`;
    return '/';
  }
}
```

Sample emitted body:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>NoSuchKey</Code>
  <Message>The specified key does not exist.</Message>
  <Key>photos/2026/sunset.jpg</Key>
  <Resource>/my-bucket/photos/2026/sunset.jpg</Resource>
  <RequestId>01913e4a-…</RequestId>
  <HostId>01913e4a-…</HostId>
</Error>
```

---

## 2.8. Operation route table

The table below is exhaustive for v1. Every row is a separate AWS operation,
distinguished from siblings by the combination of (verb, path, query). The
`@S3Operation` decorator on the matching dispatch branch sets
`req.openbucket.operation = '<Name>'` so the XML interceptor and logger can
identify it.

### 2.8.1. Service

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| GET | `/` | — | `ListBuckets` | Returns `<ListAllMyBucketsResult>`. Root creds only in v1. |

### 2.8.2. Bucket

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| PUT  | `/:bucket` | — | `CreateBucket` | Body optional; `<CreateBucketConfiguration>` if region declared. |
| DELETE | `/:bucket` | — | `DeleteBucket` | Refuses if non-empty (`BucketNotEmpty`). |
| HEAD | `/:bucket` | — | `HeadBucket` | 200 if exists+authorized, else `NoSuchBucket`. |
| GET  | `/:bucket` | — | `ListObjectsV1` | Legacy. Kept for compatibility. |
| GET  | `/:bucket` | `list-type=2` | `ListObjectsV2` | Default for modern clients. See §2.10. |
| GET  | `/:bucket` | `versions` | `ListObjectVersions` | |
| GET  | `/:bucket` | `uploads` | `ListMultipartUploads` | |
| GET  | `/:bucket` | `location` | `GetBucketLocation` | Returns `us-east-1`. |
| GET  | `/:bucket` | `acl` | `GetBucketAcl` | Single-tenant: always returns owner-full. |
| PUT  | `/:bucket` | `acl` | `PutBucketAcl` | Accepted; no-op beyond owner-full. |
| GET  | `/:bucket` | `policy` | `GetBucketPolicy` | JSON body. |
| PUT  | `/:bucket` | `policy` | `PutBucketPolicy` | JSON body. |
| DELETE | `/:bucket` | `policy` | `DeleteBucketPolicy` | |
| GET  | `/:bucket` | `cors` | `GetBucketCors` | |
| PUT  | `/:bucket` | `cors` | `PutBucketCors` | |
| DELETE | `/:bucket` | `cors` | `DeleteBucketCors` | |
| GET  | `/:bucket` | `versioning` | `GetBucketVersioning` | |
| PUT  | `/:bucket` | `versioning` | `PutBucketVersioning` | Enable / Suspend. |
| GET  | `/:bucket` | `lifecycle` | `GetBucketLifecycleConfiguration` | |
| PUT  | `/:bucket` | `lifecycle` | `PutBucketLifecycleConfiguration` | |
| DELETE | `/:bucket` | `lifecycle` | `DeleteBucketLifecycle` | |
| GET  | `/:bucket` | `tagging` | `GetBucketTagging` | |
| PUT  | `/:bucket` | `tagging` | `PutBucketTagging` | |
| DELETE | `/:bucket` | `tagging` | `DeleteBucketTagging` | |
| GET  | `/:bucket` | `encryption` | `GetBucketEncryption` | |
| PUT  | `/:bucket` | `encryption` | `PutBucketEncryption` | SSE-S3 only in v1. |
| DELETE | `/:bucket` | `encryption` | `DeleteBucketEncryption` | |
| GET  | `/:bucket` | `object-lock` | `GetObjectLockConfiguration` | |
| PUT  | `/:bucket` | `object-lock` | `PutObjectLockConfiguration` | |
| GET  | `/:bucket` | `replication` | `GetBucketReplication` | Returns `ReplicationConfigurationNotFoundError`. |
| GET  | `/:bucket` | `notification` | `GetBucketNotificationConfiguration` | Returns empty doc; PUT is `NotImplemented` in v1. |
| GET  | `/:bucket` | `accelerate` | `GetBucketAccelerateConfiguration` | Returns `Suspended`. |
| GET  | `/:bucket` | `logging` | `GetBucketLogging` | Returns empty doc. |
| GET  | `/:bucket` | `requestPayment` | `GetBucketRequestPayment` | Returns `BucketOwner`. |
| GET  | `/:bucket` | `website` | `GetBucketWebsite` | `NotImplemented`. |
| POST | `/:bucket` | `delete` | `DeleteObjects` | Bulk delete; XML body `<Delete>`. |

### 2.8.3. Object

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| PUT  | `/:bucket/:key+` | — | `PutObject` | Body is the object. |
| PUT  | `/:bucket/:key+` | — (+ `x-amz-copy-source` header) | `CopyObject` | No body. |
| GET  | `/:bucket/:key+` | — | `GetObject` | Honours `Range`, `If-Match`, etc. |
| HEAD | `/:bucket/:key+` | — | `HeadObject` | |
| DELETE | `/:bucket/:key+` | — | `DeleteObject` | Optional `versionId` query. |
| POST | `/:bucket` | — (multipart form) | `PostObject` | Browser-form upload; body is `multipart/form-data`. |
| POST | `/:bucket/:key+` | `restore` | `RestoreObject` | Stub: 200 OK. |
| GET  | `/:bucket/:key+` | `tagging` | `GetObjectTagging` | |
| PUT  | `/:bucket/:key+` | `tagging` | `PutObjectTagging` | |
| DELETE | `/:bucket/:key+` | `tagging` | `DeleteObjectTagging` | |
| GET  | `/:bucket/:key+` | `acl` | `GetObjectAcl` | |
| PUT  | `/:bucket/:key+` | `acl` | `PutObjectAcl` | Accepted; no-op. |
| GET  | `/:bucket/:key+` | `attributes` | `GetObjectAttributes` | |
| GET  | `/:bucket/:key+` | `retention` | `GetObjectRetention` | |
| PUT  | `/:bucket/:key+` | `retention` | `PutObjectRetention` | |
| GET  | `/:bucket/:key+` | `legal-hold` | `GetObjectLegalHold` | |
| PUT  | `/:bucket/:key+` | `legal-hold` | `PutObjectLegalHold` | |
| GET  | `/:bucket/:key+` | `torrent` | `GetObjectTorrent` | `NotImplemented`. |

### 2.8.4. Multipart

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| POST | `/:bucket/:key+` | `uploads` | `CreateMultipartUpload` | Returns `<InitiateMultipartUploadResult>` with `UploadId`. |
| PUT  | `/:bucket/:key+` | `uploadId=…&partNumber=N` | `UploadPart` | Body is the part. |
| PUT  | `/:bucket/:key+` | `uploadId=…&partNumber=N` + `x-amz-copy-source` | `UploadPartCopy` | No body. |
| POST | `/:bucket/:key+` | `uploadId=…` | `CompleteMultipartUpload` | XML body `<CompleteMultipartUpload>`. |
| DELETE | `/:bucket/:key+` | `uploadId=…` | `AbortMultipartUpload` | |
| GET  | `/:bucket/:key+` | `uploadId=…` | `ListParts` | |
| GET  | `/:bucket` | `uploads` | `ListMultipartUploads` | (Also listed under Bucket; same endpoint.) |

### 2.8.5. CORS preflight

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| OPTIONS | `/:bucket/:key*` | — | (preflight) | Synthesised from bucket CORS config. See §2.9. |

---

## 2.9. CORS preflight handling

S3 attaches CORS configuration to *buckets*, not to the service. Preflight
behaviour is therefore per-bucket-rules-driven.

```ts
// apps/backend/src/s3/cors/cors.controller.ts
import {
  Controller,
  Headers,
  Options,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { BucketService } from '../../domain/buckets/bucket.service';
import { RouteResolver } from '../routing/route-resolver';
import {
  AccessDeniedError,
  NoSuchBucketError,
  NoSuchCORSConfigurationError,
} from '../errors/s3-error';

@Controller()
@UseFilters(S3ExceptionFilter)
export class CorsController {
  constructor(
    private readonly buckets: BucketService,
    private readonly routes: RouteResolver,
  ) {}

  @Options(':bucketOrKey/*')
  @Options(':bucketOrKey')
  async preflight(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { bucket } = this.routes.resolve(req);
    const origin = req.headers['origin'];
    const method = req.headers['access-control-request-method'] as string | undefined;
    const requestedHeaders =
      (req.headers['access-control-request-headers'] as string | undefined)
        ?.split(',')
        .map((h) => h.trim().toLowerCase()) ?? [];

    if (!origin || !method) {
      // Non-CORS OPTIONS: respond with Allow but no CORS headers.
      res.status(200).setHeader('Allow', 'GET, HEAD, PUT, POST, DELETE, OPTIONS').end();
      return;
    }

    const bucketRow = await this.buckets.find(bucket);
    if (!bucketRow) throw new NoSuchBucketError(bucket);

    const config = bucketRow.corsConfiguration;
    if (!config) throw new NoSuchCORSConfigurationError('CORSResponse: CORS is not enabled for this bucket.');

    const rule = config.rules.find((r) =>
      matchOrigin(r.allowedOrigins, origin) &&
      r.allowedMethods.includes(method.toUpperCase()) &&
      requestedHeaders.every((h) => matchHeader(r.allowedHeaders, h)),
    );
    if (!rule) throw new AccessDeniedError('CORSResponse: This CORS request is not allowed.');

    res.setHeader('Access-Control-Allow-Origin', rule.allowedOrigins.includes('*') ? '*' : origin);
    res.setHeader('Access-Control-Allow-Methods', rule.allowedMethods.join(', '));
    if (rule.allowedHeaders.length) {
      res.setHeader('Access-Control-Allow-Headers', rule.allowedHeaders.join(', '));
    }
    if (rule.exposeHeaders?.length) {
      res.setHeader('Access-Control-Expose-Headers', rule.exposeHeaders.join(', '));
    }
    if (rule.maxAgeSeconds !== undefined) {
      res.setHeader('Access-Control-Max-Age', String(rule.maxAgeSeconds));
    }
    res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    res.status(200).end();
  }
}

function matchOrigin(allowed: string[], origin: string): boolean {
  return allowed.some((pattern) => globMatch(pattern, origin));
}
function matchHeader(allowed: string[], header: string): boolean {
  return allowed.some((pattern) => globMatch(pattern.toLowerCase(), header));
}
function globMatch(pattern: string, candidate: string): boolean {
  // AWS supports a single '*' wildcard anywhere in the pattern.
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === candidate;
  const star = pattern.indexOf('*');
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  return candidate.startsWith(head) && candidate.endsWith(tail);
}
```

OPTIONS bypasses `SigV4Guard` — AWS does not sign preflight requests, and
neither do clients. The classifier middleware sets `req.openbucket.kind =
's3'` for OPTIONS routes that fall through to the bucket prefix, and the
S3 module's controller order places `CorsController` before
`ObjectController` so that the OPTIONS verb is captured here.

---

## 2.10. ListObjectsV2 pagination

S3 returns at most `MaxKeys` (default 1000, cap 1000) objects per call.
Continuation is provided by the server as a `NextContinuationToken` string,
which the client echoes back as `?continuation-token=…` on the next call.
AWS treats the token as opaque; clients only need it to round-trip.

OpenBucket encodes the token as **`base64url(JSON.stringify(cursor))`** with
an HMAC suffix so a token cannot be forged or tampered with. The HMAC is
keyed by a per-process secret derived once at boot — token validity is
guaranteed only for the current process lifetime, which matches S3's
informal contract ("don't store tokens long-term").

```ts
// apps/backend/src/s3/pagination/continuation-token.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { InvalidArgumentError } from '../errors/s3-error';

/** What the server needs to resume a list. Opaque to clients. */
export interface ListCursor {
  /** The bucket the list is in. Used to detect token reuse across buckets. */
  b: string;
  /** Key to start *after*. S3 semantics: continuation excludes this key. */
  afterKey: string;
  /** Delimiter that was in force when the token was issued. */
  delimiter: string | null;
  /** Prefix that was in force. */
  prefix: string;
  /** Version 1 = ListObjectsV2 ordering by key. */
  v: 1;
}

@Injectable()
export class ContinuationToken implements OnModuleInit {
  private secret!: Buffer;

  onModuleInit(): void {
    // Derived at process start. Tokens are valid only within this process,
    // which is fine: every other S3-compatible server makes the same
    // assumption.
    this.secret = crypto.randomBytes(32);
  }

  encode(cursor: ListCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor), 'utf8');
    const mac = crypto.createHmac('sha256', this.secret).update(payload).digest().subarray(0, 12);
    return Buffer.concat([payload, mac]).toString('base64url');
  }

  decode(token: string, expectedBucket: string): ListCursor {
    let buf: Buffer;
    try {
      buf = Buffer.from(token, 'base64url');
    } catch {
      throw new InvalidArgumentError('invalid continuation token', 'continuation-token', token);
    }
    if (buf.length < 12) {
      throw new InvalidArgumentError('invalid continuation token', 'continuation-token', token);
    }
    const payload = buf.subarray(0, buf.length - 12);
    const mac = buf.subarray(buf.length - 12);
    const expected = crypto.createHmac('sha256', this.secret).update(payload).digest().subarray(0, 12);
    if (!crypto.timingSafeEqual(mac, expected)) {
      throw new InvalidArgumentError('continuation token failed validation', 'continuation-token', token);
    }
    let cursor: ListCursor;
    try {
      cursor = JSON.parse(payload.toString('utf8')) as ListCursor;
    } catch {
      throw new InvalidArgumentError('malformed continuation token', 'continuation-token', token);
    }
    if (cursor.v !== 1 || cursor.b !== expectedBucket) {
      throw new InvalidArgumentError('continuation token does not belong to this listing', 'continuation-token', token);
    }
    return cursor;
  }
}
```

The handler uses it like this (pseudocode — full implementation belongs to
the persistence agent, who owns the SQL):

```ts
// inside ObjectService.listObjectsV2
const cursor = req.query['continuation-token']
  ? this.tokens.decode(String(req.query['continuation-token']), bucket)
  : null;

const rows = await this.repo.listObjects({
  bucket,
  prefix: cursor?.prefix ?? (req.query.prefix as string) ?? '',
  afterKey: cursor?.afterKey ?? (req.query['start-after'] as string) ?? '',
  delimiter: cursor?.delimiter ?? (req.query.delimiter as string | undefined) ?? null,
  limit: maxKeys + 1,                          // request one extra to detect truncation
});

const truncated = rows.length > maxKeys;
const page = rows.slice(0, maxKeys);
const nextToken = truncated
  ? this.tokens.encode({
      v: 1,
      b: bucket,
      afterKey: page[page.length - 1].key,
      prefix: req.query.prefix as string ?? '',
      delimiter: (req.query.delimiter as string | undefined) ?? null,
    })
  : null;

return {
  __root: 'ListBucketResult',
  Name: bucket,
  Prefix: req.query.prefix ?? '',
  MaxKeys: maxKeys,
  KeyCount: page.length,
  IsTruncated: truncated,
  NextContinuationToken: nextToken ?? undefined,
  Contents: page.map(/* … */),
};
```

`ListObjectsV1` (no `list-type=2`) uses the same machinery but returns
`Marker` / `NextMarker` instead of continuation tokens — those are *not*
HMAC-protected because v1 marker is the last key itself, which clients
already see. v2 hides the cursor's internals behind the token, so the token
must be tamper-proof.
# 3. Persistence & Storage Layer

This section specifies the durable substrate beneath OpenBucket: the SQLite-backed metadata store, the path-mirrored blob store, and the discipline that keeps the two consistent across crashes. Everything here is single-process, single-host, single-volume. There is no distributed locking, no replication, no quorum — just one Node process, one event loop, one filesystem, one SQLite file, and a small set of rules that make atomic writes possible.

The layer is split across two locations in the Nx workspace:

- `libs/persistence/` — pure metadata: MikroORM entities, repositories, the `mikro-orm.config.ts`, and migrations. Importable by any service.
- `apps/openbucket-backend/src/storage/` — runtime filesystem code: `BlobStore`, key encoder, orphan scanner, trash manager. Lives with the app because it depends on `ConfigService` for `DATA_DIR`.

Migrations live under `apps/openbucket-backend/src/migrations/` because they are produced and applied at runtime against the configured `DATA_DIR`, not packaged with the library.

---

## 3.1 MikroORM bootstrap

### 3.1.1 `mikro-orm.config.ts`

The config is the single source of truth for the driver, entity discovery, migration directory, and the WAL-mode PRAGMA hook. It is consumed by both the runtime `MikroOrmModule.forRoot(...)` and the `mikro-orm` CLI for migrations.

`apps/openbucket-backend/src/mikro-orm.config.ts`

```ts
import { defineConfig } from '@mikro-orm/better-sqlite';
import { Migrator } from '@mikro-orm/migrations';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { join } from 'node:path';
import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
} from '@openbucket/persistence';

/**
 * Resolved once at module load. The CLI uses the env directly; the Nest runtime
 * passes a ConfigService-derived value into MikroOrmModule.forRootAsync below.
 */
const DATA_DIR = process.env.DATA_DIR ?? '/data';

export default defineConfig({
  // better-sqlite3 driver — synchronous binding, fastest for embedded use.
  dbName: join(DATA_DIR, 'openbucket.db'),

  // Entities discovered explicitly. No glob scan — startup must be deterministic
  // and we want a compile-time error if an entity is removed.
  entities: [
    Bucket,
    ObjectEntity,
    ObjectVersion,
    MultipartUpload,
    MultipartPart,
    AccessKey,
    AdminUser,
    RefreshToken,
    LifecycleState,
  ],

  // Reflection-free metadata provider; ts-morph reads decorators from the .ts
  // sources at build time, producing a metadata cache. Required when entities
  // ship in a separate lib (no decorators-in-runtime issue).
  metadataProvider: TsMorphMetadataProvider,

  // Forward-only migrations.
  extensions: [Migrator],
  migrations: {
    path: join(__dirname, 'migrations'),
    pathTs: join(__dirname, 'migrations'),
    glob: '!(*.d).{js,ts}',
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: true,
  },

  // WAL + tuning PRAGMAs. Runs once per connection. better-sqlite3 opens a
  // single connection per process so this fires exactly once at boot.
  pool: {
    afterCreate: (conn: any, done: (err?: Error) => void) => {
      try {
        // The .pragma() form is better-sqlite3 native; .prepare()/.run() also
        // works but pragma() avoids prepared-statement caching of one-shots.
        conn.pragma('journal_mode = WAL');
        conn.pragma('synchronous = NORMAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('busy_timeout = 5000');
        conn.pragma('temp_store = MEMORY');
        conn.pragma('mmap_size = 268435456'); // 256 MiB
        conn.pragma('cache_size = -65536');   // 64 MiB page cache
        done();
      } catch (err) {
        done(err as Error);
      }
    },
  },

  // Identity-map per request; one global EM is forked per RequestContext.
  allowGlobalContext: false,

  // Discriminate scalar JSON columns from real relations.
  forceUtcTimezone: true,

  // Verbose only in dev. Wire to Pino in production via MikroOrmModule logger.
  debug: process.env.NODE_ENV !== 'production',
});
```

### 3.1.2 NestJS integration

`apps/openbucket-backend/src/persistence.module.ts`

```ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { BetterSqliteDriver } from '@mikro-orm/better-sqlite';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { Migrator } from '@mikro-orm/migrations';
import { join } from 'node:path';
import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
  BucketRepository,
  ObjectRepository,
} from '@openbucket/persistence';

const ENTITIES = [
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
];

@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        driver: BetterSqliteDriver,
        dbName: join(config.getOrThrow<string>('DATA_DIR'), 'openbucket.db'),
        entities: ENTITIES,
        metadataProvider: TsMorphMetadataProvider,
        extensions: [Migrator],
        allowGlobalContext: false,
        forceUtcTimezone: true,
        migrations: {
          path: join(__dirname, 'migrations'),
          glob: '!(*.d).{js,ts}',
          transactional: true,
          allOrNothing: true,
          snapshot: true,
        },
        pool: {
          afterCreate: (conn: any, done: (err?: Error) => void) => {
            try {
              conn.pragma('journal_mode = WAL');
              conn.pragma('synchronous = NORMAL');
              conn.pragma('foreign_keys = ON');
              conn.pragma('busy_timeout = 5000');
              conn.pragma('temp_store = MEMORY');
              conn.pragma('mmap_size = 268435456');
              conn.pragma('cache_size = -65536');
              done();
            } catch (err) {
              done(err as Error);
            }
          },
        },
        debug: config.get('NODE_ENV') !== 'production',
      }),
    }),
    MikroOrmModule.forFeature({ entities: ENTITIES }),
  ],
  providers: [BucketRepository, ObjectRepository],
  exports: [MikroOrmModule, BucketRepository, ObjectRepository],
})
export class PersistenceModule {}
```

The `MikroOrmMiddleware` shipped with `@mikro-orm/nestjs` wraps every request in a `RequestContext`. It is applied globally — wired up in the backend's `main.ts` (out of scope for this section; the backend-architect agent owns app bootstrap):

```ts
// reference only — see §1 of the backend-architect deliverable
app.use(MikroOrmMiddleware);
```

With that middleware in place, any service that injects `EntityManager` gets a forked, request-scoped manager with an isolated identity map. No global EM. No leaks across requests.

### 3.1.3 Migration CLI workflow

`apps/openbucket-backend/package.json` (excerpt):

```json
{
  "scripts": {
    "orm": "mikro-orm --config=src/mikro-orm.config.ts",
    "orm:migration:create": "npm run orm -- migration:create",
    "orm:migration:up": "npm run orm -- migration:up",
    "orm:migration:list": "npm run orm -- migration:list",
    "orm:schema:fresh": "npm run orm -- schema:fresh"
  }
}
```

Migrations are **forward-only**. There is no `migration:down` workflow in production — the only supported recovery is "restore the volume". This matches the constraint that SQLite cannot be schema-rolled-back cheaply on a live data set, and it sidesteps the need for paired up/down maintenance on every change. The `mikro-orm.config.ts` deliberately omits no special flags for down-migrations; the generator still emits them, but operationally they are dead code.

The initial migration is created with:

```
npm run orm:migration:create -- --initial
```

It is committed to the repo. On container boot, the backend runs `orm:migration:up` before binding the HTTP listener — described in §3.3.

---

## 3.2 Entity definitions

All entities live in `libs/persistence/src/entities/` and are re-exported from `libs/persistence/src/index.ts`. JSON columns use MikroORM's `type: 'json'` so the driver round-trips through `JSON.parse`/`JSON.stringify`. Composite keys are declared with multiple `@PrimaryKey()` decorators.

### 3.2.1 Shared types

`libs/persistence/src/entities/types.ts`

```ts
export enum VersioningState {
  Disabled = 'disabled',
  Enabled = 'enabled',
  Suspended = 'suspended',
}

export enum ObjectLockMode {
  Off = 'off',
  Governance = 'governance',
  Compliance = 'compliance',
}

export enum StorageClass {
  Standard = 'STANDARD',
  ReducedRedundancy = 'REDUCED_REDUNDANCY',
  StandardIA = 'STANDARD_IA',
  Glacier = 'GLACIER',
  DeepArchive = 'DEEP_ARCHIVE',
}

export interface ObjectLockBucketConfig {
  enabled: boolean;
  mode?: ObjectLockMode;
  defaultRetentionDays?: number;
}

export interface ObjectLockObjectState {
  mode: ObjectLockMode;
  retainUntil?: string; // ISO-8601
  legalHold?: boolean;
}

export interface EncryptionConfig {
  algorithm: 'AES256' | 'aws:kms' | null;
  kmsKeyId?: string;
}

export interface CorsRule {
  id?: string;
  allowedOrigins: string[];
  allowedMethods: ('GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD')[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface LifecycleRule {
  id: string;
  status: 'Enabled' | 'Disabled';
  prefix?: string;
  filter?: { tag?: { key: string; value: string }; sizeGreaterThan?: number; sizeLessThan?: number };
  expirationDays?: number;
  expiredObjectDeleteMarker?: boolean;
  noncurrentVersionExpirationDays?: number;
  abortIncompleteMultipartUploadDays?: number;
}

export interface PolicyDocument {
  Version: '2012-10-17';
  Statement: Array<{
    Sid?: string;
    Effect: 'Allow' | 'Deny';
    Principal: '*' | { AWS: string | string[] };
    Action: string | string[];
    Resource: string | string[];
    Condition?: Record<string, Record<string, string | string[]>>;
  }>;
}

export type TagSet = Record<string, string>;
```

### 3.2.2 `Bucket`

`libs/persistence/src/entities/bucket.entity.ts`

```ts
import { Collection, Entity, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';
import { ObjectEntity } from './object.entity';
import {
  CorsRule,
  EncryptionConfig,
  LifecycleRule,
  ObjectLockBucketConfig,
  PolicyDocument,
  TagSet,
  VersioningState,
} from './types';

@Entity({ tableName: 'buckets' })
export class Bucket {
  @PrimaryKey({ type: 'string', length: 63 })
  name!: string;

  @Property({ type: 'string', length: 32, default: 'us-east-1' })
  region: string = 'us-east-1';

  @Property({ type: 'string', default: VersioningState.Disabled })
  versioning: VersioningState = VersioningState.Disabled;

  @Property({ type: 'json', nullable: true })
  objectLock?: ObjectLockBucketConfig;

  @Property({ type: 'json', nullable: true })
  encryption?: EncryptionConfig;

  @Property({ type: 'json', nullable: true })
  cors?: CorsRule[];

  @Property({ type: 'json', nullable: true })
  lifecycle?: LifecycleRule[];

  @Property({ type: 'json', nullable: true })
  tagging?: TagSet;

  @Property({ type: 'json', nullable: true })
  policy?: PolicyDocument;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  modifiedAt: Date = new Date();

  @OneToMany(() => ObjectEntity, (o) => o.bucket)
  objects = new Collection<ObjectEntity>(this);
}
```

### 3.2.3 `ObjectEntity`

The "current pointer" row for a key. There is one row per `(bucket, key)`. When versioning is enabled, the body referenced by this row is also reachable via the matching `ObjectVersion` row.

`libs/persistence/src/entities/object.entity.ts`

```ts
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';
import { ObjectLockObjectState, StorageClass, TagSet } from './types';

@Entity({ tableName: 'objects' })
@Unique({ name: 'uq_objects_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_objects_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_objects_bucket_softdeleted', properties: ['bucket', 'softDeleted'] })
export class ObjectEntity {
  // Surrogate PK so the FK target is stable across renames. Composite
  // (bucket, key) is enforced by the unique constraint above.
  @PrimaryKey({ type: 'string' })
  id!: string; // uuid v7 — generated in service layer

  @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @Property({ type: 'text' })
  key!: string;

  /** versionId of the version currently reachable via the path-mirror filename. */
  @Property({ type: 'string', nullable: true })
  currentVersionId?: string;

  @Property({ type: 'bigint' })
  size: bigint = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType: string = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'json', nullable: true })
  tagging?: TagSet;

  @Property({ type: 'json', nullable: true })
  lock?: ObjectLockObjectState;

  @Property({ type: 'string', default: StorageClass.Standard })
  storageClass: StorageClass = StorageClass.Standard;

  @Property({ type: 'boolean', default: false })
  softDeleted: boolean = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  modifiedAt: Date = new Date();
}
```

### 3.2.4 `ObjectVersion`

When `Bucket.versioning` is `Enabled` or `Suspended`, every PUT writes a new `ObjectVersion` row and (for non-current versions) a new blob under `<key>.v/<versionId>`. Delete-markers are versions with `isDeleteMarker = true` and no blob on disk.

`libs/persistence/src/entities/object-version.entity.ts`

```ts
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';

@Entity({ tableName: 'object_versions' })
@Index({ name: 'ix_versions_bucket_key_version', properties: ['bucket', 'key', 'versionId'] })
@Index({ name: 'ix_versions_bucket_key_created', properties: ['bucket', 'key', 'createdAt'] })
export class ObjectVersion {
  @ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @PrimaryKey({ type: 'text' })
  key!: string;

  @PrimaryKey({ type: 'string', length: 64 })
  versionId!: string; // uuid v7

  @Property({ type: 'bigint' })
  size: bigint = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType: string = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'boolean', default: false })
  isDeleteMarker: boolean = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
```

### 3.2.5 `MultipartUpload` and `MultipartPart`

`libs/persistence/src/entities/multipart-upload.entity.ts`

```ts
import { Collection, Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';
import { MultipartPart } from './multipart-part.entity';
import { EncryptionConfig } from './types';

@Entity({ tableName: 'multipart_uploads' })
@Index({ name: 'ix_mpu_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_mpu_initiated', properties: ['initiatedAt'] })
export class MultipartUpload {
  @PrimaryKey({ type: 'string', length: 64 })
  uploadId!: string; // uuid v7

  @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @Property({ type: 'text' })
  key!: string;

  @Property({ type: 'string', length: 128, default: 'root' })
  initiator: string = 'root';

  @Property({ type: 'json', nullable: true })
  encryption?: EncryptionConfig;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType: string = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'datetime' })
  initiatedAt: Date = new Date();

  @OneToMany(() => MultipartPart, (p) => p.upload, { orphanRemoval: true })
  parts = new Collection<MultipartPart>(this);
}
```

`libs/persistence/src/entities/multipart-part.entity.ts`

```ts
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { MultipartUpload } from './multipart-upload.entity';

@Entity({ tableName: 'multipart_parts' })
@Index({ name: 'ix_mpp_upload_part', properties: ['upload', 'partNumber'] })
export class MultipartPart {
  @ManyToOne(() => MultipartUpload, { primary: true, fieldName: 'upload_id', deleteRule: 'cascade' })
  upload!: MultipartUpload;

  @PrimaryKey({ type: 'integer' })
  partNumber!: number; // 1..10000 per S3 contract

  @Property({ type: 'bigint' })
  size: bigint = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  /** Optional sha256 from x-amz-checksum-* trailers. */
  @Property({ type: 'string', length: 128, nullable: true })
  checksumSha256?: string;

  @Property({ type: 'datetime' })
  writtenAt: Date = new Date();
}
```

### 3.2.6 `AccessKey`

`libs/persistence/src/entities/access-key.entity.ts`

```ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'access_keys' })
export class AccessKey {
  @PrimaryKey({ type: 'string', length: 32 })
  accessKeyId!: string;

  /** argon2id hash of the secret. Never store the plaintext. */
  @Property({ type: 'string', length: 256 })
  secretHash!: string;

  @Property({ type: 'string', length: 128, default: '' })
  label: string = '';

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'boolean', default: false })
  disabled: boolean = false;
}
```

> **Note on the SigV4 path.** SigV4 verification requires recomputing HMACs from the *plaintext* secret — a one-way hash will not work for that. For v1 the root credentials are sourced from env (`ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`) and held in memory; only future *sub-keys* are stored hashed and used for non-S3 surfaces (e.g., admin API tokens). The `AccessKey` entity is shaped for that future. The `KeyService.getSecret` interface (§3.10) papers over this distinction.

### 3.2.7 `AdminUser`

`libs/persistence/src/entities/admin-user.entity.ts`

```ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'admin_users' })
export class AdminUser {
  @PrimaryKey({ type: 'string', length: 64 })
  username!: string;

  /** argon2id hash. Verified with argon2.verify(). */
  @Property({ type: 'string', length: 256 })
  passwordHash!: string;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
```

### 3.2.8 `RefreshToken`

`libs/persistence/src/entities/refresh-token.entity.ts`

```ts
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'refresh_tokens' })
@Index({ name: 'ix_refresh_subject', properties: ['subject'] })
@Index({ name: 'ix_refresh_expires', properties: ['expiresAt'] })
export class RefreshToken {
  @PrimaryKey({ type: 'string', length: 64 })
  id!: string; // uuid v7 — also the JTI

  /** SHA-256 of the opaque token value. */
  @Property({ type: 'string', length: 128 })
  tokenHash!: string;

  @Property({ type: 'string', length: 64 })
  subject!: string;

  @Property({ type: 'datetime' })
  issuedAt: Date = new Date();

  @Property({ type: 'datetime' })
  expiresAt!: Date;

  /** Previous token id when this one was minted by rotation. */
  @Property({ type: 'string', length: 64, nullable: true })
  rotatedFrom?: string;
}
```

### 3.2.9 `LifecycleState`

`libs/persistence/src/entities/lifecycle-state.entity.ts`

```ts
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { Bucket } from './bucket.entity';

@Entity({ tableName: 'lifecycle_state' })
export class LifecycleState {
  @ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @PrimaryKey({ type: 'string', length: 64 })
  ruleId!: string;

  @Property({ type: 'datetime', nullable: true })
  lastSweepAt?: Date;

  /** Resume cursor — the last key fully processed during the previous tick. */
  @Property({ type: 'text', nullable: true })
  lastKeyProcessed?: string;
}
```

### 3.2.10 Barrel

`libs/persistence/src/index.ts`

```ts
export * from './entities/types';
export * from './entities/bucket.entity';
export * from './entities/object.entity';
export * from './entities/object-version.entity';
export * from './entities/multipart-upload.entity';
export * from './entities/multipart-part.entity';
export * from './entities/access-key.entity';
export * from './entities/admin-user.entity';
export * from './entities/refresh-token.entity';
export * from './entities/lifecycle-state.entity';
export * from './repositories/bucket.repository';
export * from './repositories/object.repository';
```

---

## 3.3 Migrations

### 3.3.1 Initial migration

Generated with `npm run orm:migration:create -- --initial`. The generator emits a class containing the `up`/`down` SQL. Below is the canonical content as it should appear on disk after generation — annotated and reformatted for clarity. Future migrations follow the same shape.

`apps/openbucket-backend/src/migrations/Migration20260520000001_initial.ts`

```ts
import { Migration } from '@mikro-orm/migrations';

export class Migration20260520000001_initial extends Migration {
  override async up(): Promise<void> {
    // ----- buckets ---------------------------------------------------------
    this.addSql(`
      create table "buckets" (
        "name"          text       not null primary key,
        "region"        text       not null default 'us-east-1',
        "versioning"    text       not null default 'disabled',
        "object_lock"   text       null,
        "encryption"    text       null,
        "cors"          text       null,
        "lifecycle"     text       null,
        "tagging"       text       null,
        "policy"        text       null,
        "created_at"    datetime   not null,
        "modified_at"   datetime   not null
      );
    `);

    // ----- objects ---------------------------------------------------------
    this.addSql(`
      create table "objects" (
        "id"                  text       not null primary key,
        "bucket_name"         text       not null,
        "key"                 text       not null,
        "current_version_id"  text       null,
        "size"                bigint     not null default 0,
        "etag"                text       not null,
        "content_type"        text       not null default 'application/octet-stream',
        "user_metadata"       text       null,
        "tagging"             text       null,
        "lock"                text       null,
        "storage_class"       text       not null default 'STANDARD',
        "soft_deleted"        boolean    not null default 0,
        "created_at"          datetime   not null,
        "modified_at"         datetime   not null,
        constraint "fk_objects_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create unique index "uq_objects_bucket_key" on "objects" ("bucket_name", "key");`);
    this.addSql(`create index "ix_objects_bucket_key" on "objects" ("bucket_name", "key");`);
    this.addSql(`create index "ix_objects_bucket_softdeleted" on "objects" ("bucket_name", "soft_deleted");`);

    // ----- object_versions -------------------------------------------------
    this.addSql(`
      create table "object_versions" (
        "bucket_name"      text       not null,
        "key"              text       not null,
        "version_id"       text       not null,
        "size"             bigint     not null default 0,
        "etag"             text       not null,
        "content_type"     text       not null default 'application/octet-stream',
        "user_metadata"    text       null,
        "is_delete_marker" boolean    not null default 0,
        "created_at"       datetime   not null,
        primary key ("bucket_name", "key", "version_id"),
        constraint "fk_versions_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create index "ix_versions_bucket_key_version" on "object_versions" ("bucket_name", "key", "version_id");`);
    this.addSql(`create index "ix_versions_bucket_key_created" on "object_versions" ("bucket_name", "key", "created_at");`);

    // ----- multipart_uploads ----------------------------------------------
    this.addSql(`
      create table "multipart_uploads" (
        "upload_id"     text       not null primary key,
        "bucket_name"   text       not null,
        "key"           text       not null,
        "initiator"     text       not null default 'root',
        "encryption"    text       null,
        "content_type"  text       not null default 'application/octet-stream',
        "user_metadata" text       null,
        "initiated_at"  datetime   not null,
        constraint "fk_mpu_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create index "ix_mpu_bucket_key" on "multipart_uploads" ("bucket_name", "key");`);
    this.addSql(`create index "ix_mpu_initiated" on "multipart_uploads" ("initiated_at");`);

    // ----- multipart_parts ------------------------------------------------
    this.addSql(`
      create table "multipart_parts" (
        "upload_id"        text       not null,
        "part_number"      integer    not null,
        "size"             bigint     not null default 0,
        "etag"             text       not null,
        "checksum_sha256"  text       null,
        "written_at"       datetime   not null,
        primary key ("upload_id", "part_number"),
        constraint "fk_mpp_upload"
          foreign key ("upload_id") references "multipart_uploads" ("upload_id") on delete cascade
      );
    `);
    this.addSql(`create index "ix_mpp_upload_part" on "multipart_parts" ("upload_id", "part_number");`);

    // ----- access_keys ----------------------------------------------------
    this.addSql(`
      create table "access_keys" (
        "access_key_id" text       not null primary key,
        "secret_hash"   text       not null,
        "label"         text       not null default '',
        "created_at"    datetime   not null,
        "disabled"      boolean    not null default 0
      );
    `);

    // ----- admin_users ----------------------------------------------------
    this.addSql(`
      create table "admin_users" (
        "username"      text       not null primary key,
        "password_hash" text       not null,
        "created_at"    datetime   not null
      );
    `);

    // ----- refresh_tokens -------------------------------------------------
    this.addSql(`
      create table "refresh_tokens" (
        "id"           text       not null primary key,
        "token_hash"   text       not null,
        "subject"      text       not null,
        "issued_at"    datetime   not null,
        "expires_at"   datetime   not null,
        "rotated_from" text       null
      );
    `);
    this.addSql(`create index "ix_refresh_subject" on "refresh_tokens" ("subject");`);
    this.addSql(`create index "ix_refresh_expires" on "refresh_tokens" ("expires_at");`);

    // ----- lifecycle_state ------------------------------------------------
    this.addSql(`
      create table "lifecycle_state" (
        "bucket_name"        text       not null,
        "rule_id"            text       not null,
        "last_sweep_at"      datetime   null,
        "last_key_processed" text       null,
        primary key ("bucket_name", "rule_id"),
        constraint "fk_lcs_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
  }

  /**
   * Down-migrations are emitted by the generator but are not part of the
   * supported operational story (see §3.3.2). Kept for tests only.
   */
  override async down(): Promise<void> {
    this.addSql('drop table if exists "lifecycle_state";');
    this.addSql('drop table if exists "refresh_tokens";');
    this.addSql('drop table if exists "admin_users";');
    this.addSql('drop table if exists "access_keys";');
    this.addSql('drop table if exists "multipart_parts";');
    this.addSql('drop table if exists "multipart_uploads";');
    this.addSql('drop table if exists "object_versions";');
    this.addSql('drop table if exists "objects";');
    this.addSql('drop table if exists "buckets";');
  }
}
```

### 3.3.2 Forward-only operational constraint

Production migrations run as part of container boot:

```ts
// apps/openbucket-backend/src/main.ts (excerpt — owned by backend-architect)
const orm = app.get(MikroORM);
await orm.getMigrator().up();
```

The forward-only constraint exists because:

1. SQLite has no per-row tombstoning of schema changes; a `DROP COLUMN` rewrites the table. Down-migrations on populated production volumes are slow and risky.
2. There is exactly one writer. Online dual-write schemes used in clustered databases do not apply.
3. The supported recovery path for "a bad migration shipped" is: restore the host-mounted volume from snapshot. This is consistent with the backup story described in `ARCHITECTURE.md` §11.

The `down()` method on each migration is preserved purely for unit-test convenience (test suites run `orm.schema.refreshDatabase()` between cases). It must not be invoked in production.

---

## 3.4 Repository pattern

MikroORM gives every entity a default `EntityRepository<T>`. Custom repositories are added only where they earn the abstraction — typically for query helpers that would otherwise be inlined into services. `BucketRepository` and `ObjectRepository` are the two that justify their existence in v1.

### 3.4.1 `BucketRepository`

`libs/persistence/src/repositories/bucket.repository.ts`

```ts
import { EntityRepository } from '@mikro-orm/better-sqlite';
import { Bucket } from '../entities/bucket.entity';
import { VersioningState } from '../entities/types';

export class BucketRepository extends EntityRepository<Bucket> {
  /** Resolve a bucket by name with strict null. Used by every S3 handler. */
  async getByName(name: string): Promise<Bucket | null> {
    return this.findOne({ name });
  }

  /** Existence check — cheaper than fetching the full row. */
  async exists(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['name'] });
    return row !== null;
  }

  /** True when the bucket emits version ids on writes. */
  async isVersioned(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['versioning'] });
    return row?.versioning === VersioningState.Enabled;
  }

  /** True when the bucket has versioning either Enabled or Suspended. */
  async hasVersionHistory(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['versioning'] });
    return row?.versioning !== VersioningState.Disabled;
  }

  /** ListBuckets admin-API helper. */
  async listAll(): Promise<Bucket[]> {
    return this.findAll({ orderBy: { name: 'ASC' } });
  }
}
```

### 3.4.2 `ObjectRepository`

The `listByPrefix` method backs `ListObjectsV2`. It deliberately uses raw SQL via the Knex query builder exposed by MikroORM — paginated prefix scans want indexed range predicates, not a generic `LIKE` that defeats the index.

`libs/persistence/src/repositories/object.repository.ts`

```ts
import { EntityRepository } from '@mikro-orm/better-sqlite';
import { ObjectEntity } from '../entities/object.entity';
import { ObjectVersion } from '../entities/object-version.entity';

export interface ListPage {
  items: ObjectEntity[];
  isTruncated: boolean;
  nextMarker?: string;
  commonPrefixes: string[];
}

export class ObjectRepository extends EntityRepository<ObjectEntity> {
  /**
   * Resolve the current pointer row for (bucket, key). Returns null if the
   * key has never existed in this bucket or if the pointer is soft-deleted.
   */
  async findCurrentVersion(bucket: string, key: string): Promise<ObjectEntity | null> {
    return this.findOne(
      { bucket: { name: bucket }, key, softDeleted: false },
      { populate: ['bucket'] },
    );
  }

  /**
   * Paginated, prefix-scoped list. Implements S3 ListObjectsV2 semantics:
   *   - prefix:   string filter on key (range scan, not LIKE)
   *   - marker:   exclusive lower bound (StartAfter / ContinuationToken)
   *   - delimiter: optional grouping char — caller passes through; the SQL
   *                returns a flat list and the service computes CommonPrefixes
   *                in memory. The SQL still uses the marker for pagination.
   *   - limit:    MaxKeys + 1 to detect truncation
   *
   * Keys are stored raw (UTF-8). SQLite compares blob-equal under BINARY
   * collation, which is what S3 specifies (byte-wise lex order).
   */
  async listByPrefix(
    bucket: string,
    prefix: string,
    marker: string | undefined,
    limit: number,
  ): Promise<{ rows: ObjectEntity[]; truncated: boolean }> {
    const qb = this.createQueryBuilder('o')
      .select('*')
      .where({ bucket: bucket, softDeleted: false });

    if (prefix.length > 0) {
      // Range scan: prefix <= key < prefix + U+FFFF-equivalent. The upper
      // bound is the prefix with its last code unit incremented; if that's
      // impossible (e.g. prefix ends in 0xFF), append a sentinel byte.
      const upper = nextStringBound(prefix);
      qb.andWhere({ key: { $gte: prefix, $lt: upper } });
    }

    if (marker !== undefined && marker.length > 0) {
      qb.andWhere({ key: { $gt: marker } });
    }

    qb.orderBy({ key: 'ASC' }).limit(limit + 1);

    const all = await qb.getResult();
    return {
      rows: all.slice(0, limit),
      truncated: all.length > limit,
    };
  }

  /** ListObjectVersions support — flat scan of the versions table by prefix. */
  async listVersionsByPrefix(
    bucket: string,
    prefix: string,
    keyMarker: string | undefined,
    versionMarker: string | undefined,
    limit: number,
  ): Promise<ObjectVersion[]> {
    const em = this.getEntityManager();
    const qb = em.createQueryBuilder(ObjectVersion, 'v')
      .select('*')
      .where({ bucket: bucket });

    if (prefix.length > 0) {
      const upper = nextStringBound(prefix);
      qb.andWhere({ key: { $gte: prefix, $lt: upper } });
    }
    if (keyMarker !== undefined) {
      if (versionMarker !== undefined) {
        qb.andWhere({
          $or: [
            { key: { $gt: keyMarker } },
            { $and: [{ key: keyMarker }, { versionId: { $gt: versionMarker } }] },
          ],
        });
      } else {
        qb.andWhere({ key: { $gt: keyMarker } });
      }
    }

    qb.orderBy({ key: 'ASC', createdAt: 'DESC' }).limit(limit + 1);
    return qb.getResult();
  }

  /** Returns the most recent non-current version for (bucket, key). */
  async findLatestVersion(bucket: string, key: string): Promise<ObjectVersion | null> {
    const em = this.getEntityManager();
    return em.findOne(
      ObjectVersion,
      { bucket: bucket, key },
      { orderBy: { createdAt: 'DESC' } },
    );
  }
}

/**
 * Compute the exclusive upper bound for a prefix range scan over UTF-8 keys.
 * Returns the smallest string greater than every string with `prefix` as a
 * prefix. Walks back from the end incrementing the first non-0xFF code unit.
 * If the entire prefix is 0xFF runs, falls back to appending 0x00 to a copy
 * that's one code unit longer — guaranteed larger than any string with that
 * prefix because SQLite BINARY comparison is byte-wise.
 */
function nextStringBound(prefix: string): string {
  const bytes = Buffer.from(prefix, 'utf8');
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] < 0xff) {
      const out = Buffer.from(bytes.subarray(0, i + 1));
      out[i] = out[i] + 1;
      return out.toString('binary'); // pass-through byte string
    }
  }
  return prefix + '￿';
}
```

The `listByPrefix` method is the workhorse behind every `ListObjectsV2` request. The service layer composes the `commonPrefixes` set in memory by scanning the result rows for the delimiter substring after the `prefix`. That decomposition lets the SQL stay simple and indexable.

---

## 3.5 Key encoding

S3 keys are arbitrary UTF-8 byte sequences of length 1–1024. The filesystem cannot host all of them safely (path separators, hidden files, Windows reserved characters, length caps). The encoder lives at the storage boundary only; SQLite stores raw keys.

`apps/openbucket-backend/src/storage/key-codec.ts`

```ts
/**
 * Filesystem-safe encoding of S3 keys to path-mirror filenames.
 *
 * Pass-through:   A-Z a-z 0-9 - _ . ~
 * Preserved:      /   (S3 "folder" convention — keys form directory trees)
 * Encoded:        everything else, byte-wise as %XX (UTF-8 bytes)
 *
 * Special cases per segment (between '/' characters):
 *   - leading '.'   → %2E  (avoid Unix hidden files)
 *   - trailing '.'  → %2E  (Windows quirk)
 *   - trailing ' '  → %20  (Windows quirk)
 *   - segment length cap: 255 bytes — throws KeyTooLongError
 */

export class KeyTooLongError extends Error {
  override readonly name = 'KeyTooLongError';
  constructor(readonly segment: string, readonly maxBytes = 255) {
    super(`encoded key segment exceeds ${maxBytes} bytes`);
  }
}

const UNRESERVED = new Set<number>();
(() => {
  const ranges: [number, number][] = [
    [0x30, 0x39], // 0-9
    [0x41, 0x5a], // A-Z
    [0x61, 0x7a], // a-z
  ];
  for (const [lo, hi] of ranges) {
    for (let c = lo; c <= hi; c++) UNRESERVED.add(c);
  }
  for (const ch of '-_.~') UNRESERVED.add(ch.charCodeAt(0));
})();

const HEX = '0123456789ABCDEF';

function encodeByte(b: number): string {
  return '%' + HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
}

function encodeSegment(segment: string): string {
  if (segment.length === 0) return ''; // double-slash path component
  const bytes = Buffer.from(segment, 'utf8');
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (UNRESERVED.has(b)) {
      out += String.fromCharCode(b);
    } else {
      out += encodeByte(b);
    }
  }

  // Leading dot becomes %2E so the directory entry is not a "hidden file"
  // on POSIX listings and so dotfile-skipping tooling doesn't miss it.
  if (out.startsWith('.')) {
    out = '%2E' + out.slice(1);
  }

  // Trailing dot or space: Windows can't host these as filenames. We're on
  // Linux in prod, but the encoding is forward-compatible.
  const last = out[out.length - 1];
  if (last === '.') {
    out = out.slice(0, -1) + '%2E';
  } else if (last === ' ') {
    out = out.slice(0, -1) + '%20';
  }

  if (Buffer.byteLength(out, 'utf8') > 255) {
    throw new KeyTooLongError(segment);
  }
  return out;
}

/**
 * Encode a full key into a filesystem-safe relative path. The '/' character
 * is preserved as a path separator. Other characters are encoded per-segment.
 */
export function encodeKey(key: string): string {
  if (key.length === 0) {
    throw new Error('empty key is not encodable');
  }
  const segments = key.split('/');
  return segments.map(encodeSegment).join('/');
}

/**
 * Decode a path-mirror filename back to a raw key. Used only for diagnostics
 * and the orphan-blob scan — the hot path reads keys from SQLite, never from
 * disk. Tolerant of malformed input: invalid %XX sequences pass through.
 */
export function decodeKey(encoded: string): string {
  const segments = encoded.split('/');
  return segments.map(decodeSegment).join('/');
}

function decodeSegment(segment: string): string {
  if (segment.length === 0) return '';
  const out: number[] = [];
  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charCodeAt(i);
    if (ch === 0x25 /* % */ && i + 2 < segment.length) {
      const hi = parseHex(segment.charCodeAt(i + 1));
      const lo = parseHex(segment.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        out.push((hi << 4) | lo);
        i += 2;
        continue;
      }
    }
    out.push(ch);
  }
  return Buffer.from(out).toString('utf8');
}

function parseHex(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}
```

### 3.5.1 Unit tests

Co-located: `apps/openbucket-backend/src/storage/key-codec.spec.ts`

```ts
import { describe, expect, it } from '@jest/globals';
import { decodeKey, encodeKey, KeyTooLongError } from './key-codec';

describe('encodeKey / decodeKey', () => {
  const roundtrip = (raw: string) => {
    const encoded = encodeKey(raw);
    expect(decodeKey(encoded)).toBe(raw);
  };

  describe('pass-through', () => {
    it('ASCII alphanumerics are unchanged', () => {
      expect(encodeKey('hello-world_123.txt')).toBe('hello-world_123.txt');
    });

    it('unreserved RFC3986 chars survive', () => {
      expect(encodeKey('a-b_c.d~e')).toBe('a-b_c.d~e');
    });

    it('preserves / as path separator', () => {
      expect(encodeKey('photos/2026/may.jpg')).toBe('photos/2026/may.jpg');
    });
  });

  describe('percent-encoding', () => {
    it('encodes space as %20', () => {
      expect(encodeKey('my file.txt')).toBe('my%20file.txt');
    });

    it('encodes question mark and ampersand', () => {
      expect(encodeKey('a?b&c=d')).toBe('a%3Fb%26c%3Dd');
    });

    it('encodes UTF-8 multi-byte sequences byte-wise', () => {
      // U+00E9 = 0xC3 0xA9 ; U+1F600 = 0xF0 0x9F 0x98 0x80
      expect(encodeKey('cafeé.txt')).toBe('cafe%C3%A9.txt');
      expect(encodeKey('emoji\u{1F600}')).toBe('emoji%F0%9F%98%80');
    });

    it('encodes control characters', () => {
      expect(encodeKey('a\nb\tc')).toBe('a%0Ab%09c');
    });
  });

  describe('hidden / quirky segments', () => {
    it('rewrites leading dot to %2E', () => {
      expect(encodeKey('.htaccess')).toBe('%2Ehtaccess');
    });

    it('rewrites leading dot in inner segment', () => {
      expect(encodeKey('a/.b/c')).toBe('a/%2Eb/c');
    });

    it('rewrites trailing dot to %2E', () => {
      expect(encodeKey('foo.')).toBe('foo%2E');
    });

    it('rewrites trailing space to %20', () => {
      expect(encodeKey('foo ')).toBe('foo%20');
    });

    it('handles leading-and-trailing-dot segment', () => {
      // leading dot rule fires first; trailing dot rule fires next.
      expect(encodeKey('.hidden.')).toBe('%2Ehidden%2E');
    });
  });

  describe('length cap', () => {
    it('rejects segments whose encoded form exceeds 255 bytes', () => {
      // Each multi-byte UTF-8 char inflates 3x under %XX. 90 emoji = 360 bytes.
      const segment = '\u{1F600}'.repeat(90);
      expect(() => encodeKey(segment)).toThrow(KeyTooLongError);
    });

    it('accepts a 255-byte segment exactly', () => {
      const segment = 'a'.repeat(255);
      expect(encodeKey(segment)).toBe(segment);
    });
  });

  describe('roundtrip', () => {
    it.each([
      'simple.txt',
      'photos/2026/05/20/cat.jpg',
      'my file with spaces.bin',
      'a?b&c=d',
      'cafeé.txt',
      'a\nb',
      '.htaccess',
      'trailing.',
      'trailing ',
      '\u{1F4A9}\u{1F600}.bin',
    ])('roundtrips %j', roundtrip);
  });

  describe('edge cases', () => {
    it('rejects empty key', () => {
      expect(() => encodeKey('')).toThrow(/empty key/);
    });

    it('preserves consecutive slashes as empty segments', () => {
      expect(encodeKey('a//b')).toBe('a//b');
      expect(decodeKey('a//b')).toBe('a//b');
    });

    it('decode tolerates malformed % escapes', () => {
      expect(decodeKey('a%ZZ')).toBe('a%ZZ');
      expect(decodeKey('a%')).toBe('a%');
    });
  });
});
```

The S3 controller layer (owned by the S3 agent) catches `KeyTooLongError` thrown from any service that constructs a storage path and maps it to `HTTP 400 KeyTooLongError` — the AWS code for over-long keys.

---

## 3.6 BlobStore

The `BlobStore` is the single point of contact between domain services and the host filesystem. It owns:

- atomic stage-and-rename semantics (writes never appear at their final path partially),
- per-object hashing during ingestion (no second pass),
- `EXDEV` fallback for the rare case where `tmp/` and `blobs/` ended up on different devices,
- soft-delete via trash relocation,
- multipart composition (parts → final).

It does **not** own stream lifecycles (abort cleanup, backpressure tuning) — those belong to the streaming agent, which consumes the signatures below.

### 3.6.1 Path resolver

`apps/openbucket-backend/src/storage/paths.ts`

```ts
import { join } from 'node:path';
import { encodeKey } from './key-codec';

export class PathResolver {
  constructor(private readonly dataDir: string) {}

  blobsDir(): string {
    return join(this.dataDir, 'blobs');
  }
  bucketDir(bucket: string): string {
    return join(this.blobsDir(), bucket);
  }
  blobPath(bucket: string, key: string): string {
    return join(this.bucketDir(bucket), encodeKey(key));
  }
  versionDir(bucket: string, key: string): string {
    return this.blobPath(bucket, key) + '.v';
  }
  versionPath(bucket: string, key: string, versionId: string): string {
    return join(this.versionDir(bucket, key), versionId);
  }
  multipartDir(uploadId: string): string {
    return join(this.dataDir, 'multipart', uploadId);
  }
  multipartPartPath(uploadId: string, partNumber: number): string {
    return join(this.multipartDir(uploadId), `${partNumber}.part`);
  }
  tmpDir(): string {
    return join(this.dataDir, 'tmp');
  }
  tmpPath(name: string): string {
    return join(this.tmpDir(), name);
  }
  trashDir(): string {
    return join(this.dataDir, 'trash');
  }
}
```

### 3.6.2 `BlobStore` — interface and implementation

`apps/openbucket-backend/src/storage/blob-store.ts`

```ts
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  promises as fs,
  ReadStream,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolver } from './paths';

export interface PutResult {
  /** Bytes written, post-flush. */
  size: bigint;
  /** Hex MD5 — the canonical S3 ETag for single-part objects. */
  etag: string;
  /** Hex SHA-256 — for x-amz-content-sha256 verification. */
  sha256: string;
  /** Final on-disk path after rename. */
  finalPath: string;
}

export interface RangeSpec {
  /** Inclusive byte offset. */
  start: number;
  /** Inclusive byte offset, or undefined to read through EOF. */
  end?: number;
}

export interface HeadResult {
  size: bigint;
  mtime: Date;
}

export interface BlobRef {
  path: string;
  size: bigint;
}

@Injectable()
export class BlobStore {
  private readonly log = new Logger(BlobStore.name);
  private readonly paths: PathResolver;

  constructor(config: ConfigService) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  /**
   * Stage a blob in tmp/, compute its hashes while streaming, then atomically
   * rename to its final destination. Returns size + hashes + final path.
   *
   * `source` may be a Readable (request body) or an absolute filesystem path
   * (used internally by composeBlobs and the multipart finaliser).
   *
   * Stream lifecycle (abort, backpressure) is the caller's responsibility —
   * the streaming agent wires AbortSignal handling around this method.
   */
  async putBlob(
    bucket: string,
    key: string,
    source: Readable | string,
  ): Promise<PutResult> {
    await this.ensureDir(this.paths.tmpDir());
    const tmpName = `put-${randomUUID()}`;
    const tmpPath = this.paths.tmpPath(tmpName);
    const finalPath = this.paths.blobPath(bucket, key);

    const md5 = createHash('md5');
    const sha = createHash('sha256');
    let bytesWritten = 0n;

    const sink = createWriteStream(tmpPath, { flags: 'wx' });
    const input: Readable = typeof source === 'string' ? createReadStream(source) : source;

    try {
      // We hash inline by tapping the source. pipeline propagates errors and
      // tears down both streams on abort.
      input.on('data', (chunk: Buffer) => {
        md5.update(chunk);
        sha.update(chunk);
        bytesWritten += BigInt(chunk.length);
      });
      await pipeline(input, sink);
      // fsync the file so the rename actually buys us durability.
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await this.ensureDir(dirname(finalPath));
    await this.atomicRename(tmpPath, finalPath);

    return {
      size: bytesWritten,
      etag: md5.digest('hex'),
      sha256: sha.digest('hex'),
      finalPath,
    };
  }

  /**
   * Open a read stream for the blob at (bucket, key), optionally constrained
   * to a byte range. The returned `stream` is a `fs.ReadStream` so callers
   * can wire `.on('error')` and abort it.
   *
   * Throws ENOENT-equivalent if the blob is missing — caller maps to NoSuchKey.
   */
  async getBlob(
    bucket: string,
    key: string,
    range?: RangeSpec,
  ): Promise<{ stream: ReadStream; size: bigint }> {
    const path = this.paths.blobPath(bucket, key);
    const stat = await fs.stat(path);
    const opts: { start?: number; end?: number } = {};
    if (range) {
      opts.start = range.start;
      if (range.end !== undefined) opts.end = range.end;
    }
    const stream = createReadStream(path, opts);
    return { stream, size: BigInt(stat.size) };
  }

  /**
   * Stat-only — used by HEAD requests where the body isn't needed. Returns
   * null on ENOENT so callers don't have to catch.
   */
  async headBlob(bucket: string, key: string): Promise<HeadResult | null> {
    try {
      const stat = await fs.stat(this.paths.blobPath(bucket, key));
      return { size: BigInt(stat.size), mtime: stat.mtime };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Soft-delete: move the blob into trash/ with a manifest entry. The actual
   * unlink happens in the trash purge background tick (streaming agent).
   */
  async deleteBlob(bucket: string, key: string): Promise<void> {
    const src = this.paths.blobPath(bucket, key);
    await this.ensureDir(this.paths.trashDir());

    const entryId = randomUUID();
    const dst = join(this.paths.trashDir(), entryId);

    try {
      await this.atomicRename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Already gone — idempotent.
        return;
      }
      throw err;
    }

    const manifest = {
      entryId,
      bucket,
      key,
      originalPath: src,
      deletedAt: new Date().toISOString(),
    };
    await fs.writeFile(`${dst}.manifest.json`, JSON.stringify(manifest, null, 2));
  }

  /**
   * Concatenate `parts` into a single blob at (destBucket, destKey). Used by
   * CompleteMultipartUpload. The composed file is staged in tmp/ and renamed,
   * preserving the same atomicity guarantee as putBlob.
   *
   * Hashing: MD5 is recomputed over the concatenated content for the final
   * ETag (note: S3 reports a different ETag format for multipart objects —
   * "<md5-of-concatenated-part-md5s>-<partCount>". The service layer derives
   * that from per-part ETags; this method returns the raw single-blob MD5.)
   */
  async composeBlobs(
    parts: BlobRef[],
    destBucket: string,
    destKey: string,
  ): Promise<PutResult> {
    await this.ensureDir(this.paths.tmpDir());
    const tmpName = `compose-${randomUUID()}`;
    const tmpPath = this.paths.tmpPath(tmpName);
    const finalPath = this.paths.blobPath(destBucket, destKey);

    const md5 = createHash('md5');
    const sha = createHash('sha256');
    let bytesWritten = 0n;

    const sink = createWriteStream(tmpPath, { flags: 'wx' });
    try {
      for (const part of parts) {
        const partStream = createReadStream(part.path);
        partStream.on('data', (chunk: Buffer) => {
          md5.update(chunk);
          sha.update(chunk);
          bytesWritten += BigInt(chunk.length);
        });
        // pipe but don't close the sink between parts
        await new Promise<void>((resolve, reject) => {
          partStream.on('error', reject);
          partStream.on('end', resolve);
          partStream.pipe(sink, { end: false });
        });
      }
      // Now end the sink and fsync.
      await new Promise<void>((resolve, reject) => {
        sink.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await this.ensureDir(dirname(finalPath));
    await this.atomicRename(tmpPath, finalPath);
    return {
      size: bytesWritten,
      etag: md5.digest('hex'),
      sha256: sha.digest('hex'),
      finalPath,
    };
  }

  // ----- internals -------------------------------------------------------

  private async ensureDir(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true });
  }

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch {
      /* ignore — best-effort cleanup */
    }
  }

  private async fsyncFile(path: string): Promise<void> {
    const fh = await fs.open(path, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  /**
   * rename(2) is atomic only on the same filesystem. If tmp/ and the
   * destination live on different mounts (operator misconfiguration or
   * containerised volumes), Node returns EXDEV. Fall back to copy+unlink —
   * not atomic, but correct under the constraint, and noisy in the log so
   * the operator notices.
   */
  private async atomicRename(src: string, dst: string): Promise<void> {
    try {
      await fs.rename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      this.log.warn(
        `EXDEV: ${src} -> ${dst} is cross-device. Falling back to copy+unlink. ` +
          'Check that DATA_DIR/tmp and DATA_DIR/blobs share a mount.',
      );
      await fs.copyFile(src, dst);
      await this.unlinkQuiet(src);
    }
  }
}
```

### 3.6.3 Contracts for the streaming agent

These are the function signatures the streaming agent must consume. They are stable.

```ts
putBlob(bucket: string, key: string, source: Readable | string): Promise<PutResult>;
getBlob(bucket: string, key: string, range?: RangeSpec): Promise<{ stream: ReadStream; size: bigint }>;
headBlob(bucket: string, key: string): Promise<HeadResult | null>;
deleteBlob(bucket: string, key: string): Promise<void>;
composeBlobs(parts: BlobRef[], destBucket: string, destKey: string): Promise<PutResult>;
```

The streaming agent owns: piping `IncomingMessage` into `putBlob` with `AbortController` wiring, `Range` header parsing into `RangeSpec`, `Content-Range`/`206` response headers around `getBlob`, and the trash-purge background tick that walks `trash/*.manifest.json` and unlinks expired entries.

---

## 3.7 Two-phase commit pattern

A successful object write has two artefacts: a file on disk and a row in SQLite. Either alone is incomplete. The canonical sequence ensures that the row is never written before the file is durable, so a crash never leaves a row pointing at non-existent bytes.

### 3.7.1 Canonical write flow

```
Client                Service              BlobStore           EM/SQLite       Filesystem
  |  PUT (stream)        |                    |                    |               |
  |--------------------->|                    |                    |               |
  |                      | em.begin()         |                    |               |
  |                      |-------------------------------------- ->|               |
  |                      |                    |                    |               |
  |                      | putBlob(stream) -> | (1) open tmp file -|-----[wx]----->|
  |                      |                    | (2) stream + hash  |               |
  |                      |                    | (3) fsync           |               |
  |                      |                    | (4) rename tmp -> final ---------->|
  |                      |<-- {size,etag,…} --|                    |               |
  |                      |                    |                    |               |
  |                      | em.upsert(ObjectEntity { …, etag, size, …})              |
  |                      |-------------------------------------- ->|               |
  |                      | em.commit()                              |               |
  |                      |-------------------------------------- ->|               |
  |                      |                                          | fsync wal     |
  |                      |<------------------ OK -------------------|               |
  |<------- 200 ---------|                                          |               |
```

### 3.7.2 Reference implementation

`apps/openbucket-backend/src/storage/object-writer.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BlobStore } from './blob-store';
import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  StorageClass,
  VersioningState,
} from '@openbucket/persistence';

export interface PutObjectCmd {
  bucket: string;
  key: string;
  body: Readable;
  contentType?: string;
  userMetadata?: Record<string, string>;
}

@Injectable()
export class ObjectWriterService {
  private readonly log = new Logger(ObjectWriterService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly blobs: BlobStore,
  ) {}

  /**
   * The canonical two-phase write. Order is fixed:
   *   1. Open transaction (no SQL issued yet)
   *   2. Stage blob in tmp/  (BlobStore.putBlob)
   *   3. Atomic rename to final path  (still inside putBlob)
   *   4. Insert/update ObjectEntity row
   *   5. Commit transaction
   *   6. On failure after step 3: best-effort unlink of the renamed file.
   *
   * The crash window: post-rename, pre-commit (between steps 3 and 5). A
   * power loss here leaves an orphan blob — reconciled by §3.8.
   */
  async put(cmd: PutObjectCmd): Promise<ObjectEntity> {
    const em = this.em.fork();
    await em.begin();

    let finalPath: string | undefined;
    try {
      // Step 2 + 3: stage + atomic rename. After this returns, the file
      // already lives at its final location.
      const put = await this.blobs.putBlob(cmd.bucket, cmd.key, cmd.body);
      finalPath = put.finalPath;

      const bucket = await em.findOneOrFail(Bucket, { name: cmd.bucket });

      // Step 4: upsert the pointer row.
      let row = await em.findOne(ObjectEntity, {
        bucket: { name: cmd.bucket },
        key: cmd.key,
      });
      if (!row) {
        row = new ObjectEntity();
        row.id = randomUUID();
        row.bucket = bucket;
        row.key = cmd.key;
      }
      row.size = put.size;
      row.etag = put.etag;
      row.contentType = cmd.contentType ?? 'application/octet-stream';
      row.userMetadata = cmd.userMetadata;
      row.storageClass = StorageClass.Standard;
      row.softDeleted = false;
      row.modifiedAt = new Date();

      // Versioning side-effects (see §3.11 for full treatment).
      if (bucket.versioning !== VersioningState.Disabled) {
        const versionId = randomUUID();
        row.currentVersionId = versionId;

        const ver = em.create(ObjectVersion, {
          bucket,
          key: cmd.key,
          versionId,
          size: put.size,
          etag: put.etag,
          contentType: row.contentType,
          userMetadata: row.userMetadata,
          isDeleteMarker: false,
          createdAt: new Date(),
        });
        em.persist(ver);
      }

      em.persist(row);
      // Step 5: commit. May throw on constraint failure.
      await em.commit();
      return row;
    } catch (err) {
      // Step 6: rollback row state. Then unlink the file we just promoted,
      // best-effort — if this fails the orphan scan will eventually find it.
      await em.rollback().catch(() => undefined);
      if (finalPath) {
        try {
          await fs.unlink(finalPath);
        } catch (unlinkErr) {
          this.log.warn(
            `failed to clean up post-rename file after commit error: ${finalPath}: ${(unlinkErr as Error).message}`,
          );
        }
      }
      throw err;
    }
  }
}
```

### 3.7.3 The crash window

There is exactly one window where state can diverge: between the successful `rename()` (step 3) and a successful commit (step 5). Loss of power, OOM-kill, or container restart in that window leaves:

- A file at `<DATA_DIR>/blobs/<bucket>/<encoded-key>` — durable, fsync'd.
- No corresponding row in `objects`.

This is an **orphan blob**. It is harmless — it cannot be read because no metadata references it — but it occupies disk. The orphan scan in §3.8 finds and logs these. v1 does not auto-delete; an operator can run the scan in repair mode (a future flag) to remove them.

The reverse failure — row committed, file missing — is **prevented by construction**. The row is never written until after rename succeeds.

---

## 3.8 Crash recovery & orphan scan

Runs once at startup, before the HTTP server begins accepting requests. Two passes:

1. **Blob scan**: walk `blobs/`, compare each file to the `objects` table. Orphans logged.
2. **Multipart scan**: walk `multipart/`, compare each `<upload-id>` directory to the `multipart_uploads` table. Directories without a row are deleted (they cannot be resumed — the upload state is gone).

`apps/openbucket-backend/src/storage/recovery.service.ts`

```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PathResolver } from './paths';
import { decodeKey } from './key-codec';
import { MultipartUpload, ObjectEntity } from '@openbucket/persistence';

interface OrphanReport {
  orphanBlobs: { path: string; bucket: string; key: string }[];
  removedMultipartDirs: string[];
  scanned: { blobs: number; multipart: number };
}

@Injectable()
export class RecoveryService implements OnApplicationBootstrap {
  private readonly log = new Logger(RecoveryService.name);
  private readonly paths: PathResolver;

  constructor(
    private readonly em: EntityManager,
    config: ConfigService,
  ) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  async onApplicationBootstrap(): Promise<void> {
    const t0 = Date.now();
    const report = await this.runScan();
    this.log.log(
      `recovery scan: ${report.scanned.blobs} blobs, ${report.scanned.multipart} multipart dirs ` +
        `in ${Date.now() - t0}ms; ${report.orphanBlobs.length} orphan blobs, ` +
        `${report.removedMultipartDirs.length} stale multipart dirs cleaned`,
    );
    if (report.orphanBlobs.length > 0) {
      // Log first 50 paths so an operator can investigate without grepping
      // through the filesystem manually.
      for (const o of report.orphanBlobs.slice(0, 50)) {
        this.log.warn(`orphan blob: bucket=${o.bucket} key=${o.key} path=${o.path}`);
      }
    }
  }

  async runScan(): Promise<OrphanReport> {
    const orphanBlobs: OrphanReport['orphanBlobs'] = [];
    const removedMultipartDirs: string[] = [];
    let blobsScanned = 0;
    let multipartScanned = 0;

    // ----- blob pass -----------------------------------------------------
    const blobsRoot = this.paths.blobsDir();
    if (await this.exists(blobsRoot)) {
      const bucketDirs = await fs.readdir(blobsRoot, { withFileTypes: true });
      for (const bucketDirent of bucketDirs) {
        if (!bucketDirent.isDirectory()) continue;
        const bucket = bucketDirent.name;
        const bucketRoot = join(blobsRoot, bucket);
        for await (const filePath of this.walk(bucketRoot)) {
          blobsScanned++;
          // Skip version-store directories — they're reconciled via
          // ObjectVersion rows.  *.v/ paths and trash-shaped paths are
          // ignored here; the version reconciliation pass below handles them.
          const rel = relative(bucketRoot, filePath);
          if (rel.includes('.v' + '/') || rel.includes('.v' + '\\')) continue;

          const decoded = decodeKey(rel.replaceAll('\\', '/'));
          const row = await this.em.findOne(
            ObjectEntity,
            { bucket: { name: bucket }, key: decoded },
            { fields: ['id'] },
          );
          if (!row) {
            orphanBlobs.push({ path: filePath, bucket, key: decoded });
          }
        }
      }
    }

    // ----- multipart pass ------------------------------------------------
    const multipartRoot = join(this.paths['dataDir' as never] as never, 'multipart');
    // Resolve via PathResolver instead of poking private state:
    const mpRoot = this.paths.multipartDir('').slice(0, -1); // strip trailing sep
    if (await this.exists(mpRoot)) {
      const uploadDirs = await fs.readdir(mpRoot, { withFileTypes: true });
      for (const d of uploadDirs) {
        if (!d.isDirectory()) continue;
        multipartScanned++;
        const uploadId = d.name;
        const row = await this.em.findOne(
          MultipartUpload,
          { uploadId },
          { fields: ['uploadId'] },
        );
        if (!row) {
          const dirPath = join(mpRoot, uploadId);
          await fs.rm(dirPath, { recursive: true, force: true });
          removedMultipartDirs.push(dirPath);
        }
      }
    }

    return {
      orphanBlobs,
      removedMultipartDirs,
      scanned: { blobs: blobsScanned, multipart: multipartScanned },
    };
  }

  private async *walk(root: string): AsyncIterable<string> {
    const stack: string[] = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      for (const ent of entries) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(p);
        } else if (ent.isFile()) {
          yield p;
        }
      }
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
```

The scan never auto-deletes orphan blobs in v1. The rationale: a misconfigured `DATA_DIR` (operator points the container at the wrong volume) would otherwise nuke real data. Logging is the safe default. A future `--repair` mode can unlink them after a confirmation prompt.

---

## 3.9 Trash management

Soft-delete is implemented by relocating a blob into `<DATA_DIR>/trash/<uuid>` with a sibling JSON manifest at `<DATA_DIR>/trash/<uuid>.manifest.json`. The metadata row is updated separately by the service layer (typically `softDeleted = true` on `ObjectEntity`, or a delete-marker `ObjectVersion` row, depending on versioning state).

**Manifest schema** (one file per trash entry):

```ts
interface TrashManifest {
  entryId: string;          // matches the trash filename
  bucket: string;           // raw bucket name
  key: string;              // raw S3 key
  originalPath: string;     // absolute path the blob was renamed from
  deletedAt: string;        // ISO-8601
  scheduledPurgeAt?: string;// ISO-8601 — set by lifecycle service when applicable
}
```

Writing the manifest happens **after** the blob is renamed into trash. If the manifest write fails, the file remains in trash without a manifest — the purge tick treats unmanifested trash files as "purge after grace period" with a configurable default grace.

The actual purge — walking `trash/*.manifest.json`, comparing `scheduledPurgeAt` to `Date.now()`, and unlinking — runs on the background tick owned by the streaming agent. This module provides only the move-to-trash operation, which is `BlobStore.deleteBlob` (§3.6.2).

There is no SQLite table for trash entries in v1. The filesystem is the source of truth, and the manifest doubles as the record. Adding a `trash` table later (for fast counting / listing in the admin UI) is a forward-compatible change.

---

## 3.10 `KeyService.getSecret` interface

The SigV4 guard owned by the S3 agent needs to recover the plaintext secret for an `accessKeyId`. v1 has exactly one root key pair sourced from env (`ROOT_ACCESS_KEY_ID` / `ROOT_SECRET_ACCESS_KEY`), held in memory. The interface is designed so future sub-keys can plug in without touching the guard.

`apps/openbucket-backend/src/storage/key.service.ts`

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { ConfigService } from '@nestjs/config';
import { AccessKey } from '@openbucket/persistence';

export interface KeyLookupResult {
  accessKeyId: string;
  secret: string;
  disabled: boolean;
  /** True when this key is the root pair from env, not a stored sub-key. */
  isRoot: boolean;
}

@Injectable()
export class KeyService implements OnModuleInit {
  private readonly log = new Logger(KeyService.name);

  /**
   * In-memory cache keyed by accessKeyId. Holds:
   *   - the root pair (loaded at boot from env)
   *   - any sub-keys that have been looked up since.
   *
   * Sub-keys are stored *with their plaintext secret* in memory only — never
   * persisted that way. The DB holds an argon2id hash; that's only useful for
   * the admin UI to confirm key validity at creation time. SigV4 needs the
   * plaintext, which is why v1 has only the root key (loaded from env).
   *
   * Future sub-key support will require a different SigV4 storage model
   * (e.g. envelope-encrypted secrets unsealed at boot with KEK from env).
   * Out of scope for v1. The interface here is forward-compatible.
   */
  private readonly cache = new Map<string, KeyLookupResult>();

  constructor(
    private readonly em: EntityManager,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
    const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
    this.cache.set(rootId, {
      accessKeyId: rootId,
      secret: rootSecret,
      disabled: false,
      isRoot: true,
    });
    this.log.log(`KeyService loaded root access key (id=${redact(rootId)})`);
  }

  /**
   * Hot-path lookup for the SigV4 guard. Returns null when the key is
   * unknown OR disabled. Disabled keys are cached as `disabled: true` so a
   * disabled flood doesn't hammer SQLite.
   */
  async getSecret(accessKeyId: string): Promise<KeyLookupResult | null> {
    const cached = this.cache.get(accessKeyId);
    if (cached) {
      return cached.disabled ? null : cached;
    }

    // v1: there are no sub-keys with usable plaintext secrets. Every miss is
    // a not-found. Wired for future expansion.
    const row = await this.em.findOne(AccessKey, { accessKeyId });
    if (!row) return null;

    // Sub-key lookup path — currently unreachable. When sub-keys ship,
    // unwrap the encrypted secret here, populate cache, return.
    this.log.warn(
      `KeyService: accessKeyId=${redact(accessKeyId)} found in DB but no plaintext available — ` +
        'sub-key support not enabled in v1',
    );
    return null;
  }

  /**
   * Invalidate cache entries. Called by the admin API when a key is
   * disabled, deleted, or rotated. Root key is never invalidated this way —
   * it is bound to the boot env.
   */
  invalidate(accessKeyId: string): void {
    const cached = this.cache.get(accessKeyId);
    if (cached?.isRoot) return;
    this.cache.delete(accessKeyId);
  }

  /** Test-only and emergency-rotate hook for the root key. */
  reloadRootFromEnv(): void {
    const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
    const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
    for (const [id, entry] of this.cache) {
      if (entry.isRoot) this.cache.delete(id);
    }
    this.cache.set(rootId, {
      accessKeyId: rootId,
      secret: rootSecret,
      disabled: false,
      isRoot: true,
    });
  }
}

function redact(id: string): string {
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}
```

The S3 agent's `SigV4Guard` consumes this as:

```ts
const lookup = await this.keyService.getSecret(parsed.accessKeyId);
if (!lookup) throw new InvalidAccessKeyId();
const expected = aws4.sign({ /* canonical request */ }, { secretAccessKey: lookup.secret });
// compare expected.headers.Authorization to incoming
```

Cache invalidation on admin-side updates (disable, delete) is the admin module's responsibility — it calls `KeyService.invalidate(accessKeyId)` inside the same transaction that mutates the `access_keys` row. Because the cache is in-process and there is only one process, no distributed invalidation is needed.

---

## 3.11 Versioning storage

When a bucket has versioning `Enabled` or `Suspended`, every prior version of an object has its own row in `object_versions` and its own file on disk under a per-key version directory.

### 3.11.1 On-disk layout

```
blobs/
  <bucket>/
    photos/2026/may.jpg            # current version — directly addressable
    photos/2026/may.jpg.v/         # per-key version directory
      01J3K0...A                   # version id 1 (uuid v7, sortable by time)
      01J3K1...B                   # version id 2
      01J3K2...C                   # version id 3
```

The current pointer (`photos/2026/may.jpg`) is **always** a regular file when a current version exists. It may be the *same content* as the most recent `.v/<id>` file, or it may be conceptually distinct (e.g., during a brief window of an in-progress PUT). The relationship is mediated through SQLite — `ObjectEntity.currentVersionId` is the authoritative pointer.

Delete-markers are versions with no blob: an `ObjectVersion` row with `isDeleteMarker = true` and no corresponding file under `<key>.v/`. When the most recent version is a delete-marker, the pointer file at `blobs/<bucket>/<encoded-key>` is removed (moved to trash), and `ObjectEntity.softDeleted` is set to `true`. `GET` returns 404. `GET ?versionId=<previous>` still works because the historical version file is intact.

### 3.11.2 Promote-to-current

`apps/openbucket-backend/src/storage/version-store.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { promises as fs } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { BlobStore } from './blob-store';
import { PathResolver } from './paths';
import { ObjectEntity, ObjectVersion } from '@openbucket/persistence';

@Injectable()
export class VersionStoreService {
  private readonly paths: PathResolver;

  constructor(
    private readonly em: EntityManager,
    private readonly blobs: BlobStore,
    config: ConfigService,
  ) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  /**
   * Promote a stored non-current version to be the bucket's current pointer.
   * Used by lifecycle ("noncurrent expiration with retention=1" — keep one
   * past version) and by admin-side restore operations.
   *
   * Sequence:
   *   1. Look up the version row.
   *   2. Verify the version blob exists on disk.
   *   3. Compose into tmp/ (which is just a cp from the version file) and
   *      atomically rename over the current pointer.
   *   4. Update ObjectEntity.currentVersionId in the same EM transaction
   *      that wraps the rename — same two-phase commit discipline as §3.7.
   */
  async promoteToCurrent(bucket: string, key: string, versionId: string): Promise<void> {
    const em = this.em.fork();
    await em.begin();
    try {
      const ver = await em.findOne(
        ObjectVersion,
        { bucket: { name: bucket }, key, versionId },
      );
      if (!ver || ver.isDeleteMarker) {
        throw new NotFoundException('version not found or is a delete marker');
      }

      const versionPath = this.paths.versionPath(bucket, key, versionId);
      // Stat to make sure the blob is there.
      await fs.stat(versionPath);

      // Compose with a single source: cheapest copy with atomic rename.
      await this.blobs.composeBlobs(
        [{ path: versionPath, size: ver.size }],
        bucket,
        key,
      );

      const row = await em.findOneOrFail(ObjectEntity, {
        bucket: { name: bucket },
        key,
      });
      row.currentVersionId = versionId;
      row.size = ver.size;
      row.etag = ver.etag;
      row.contentType = ver.contentType;
      row.userMetadata = ver.userMetadata;
      row.softDeleted = false;
      row.modifiedAt = new Date();
      em.persist(row);

      await em.commit();
    } catch (err) {
      await em.rollback().catch(() => undefined);
      throw err;
    }
  }

  /**
   * List all versions for keys with `prefix`, newest first per key.
   * Backs the S3 ListObjectVersions operation.
   */
  async listVersions(
    bucket: string,
    prefix: string,
    keyMarker: string | undefined,
    versionMarker: string | undefined,
    limit: number,
  ): Promise<ObjectVersion[]> {
    // Implemented via ObjectRepository.listVersionsByPrefix — see §3.4.2.
    // Repeated here for the interface contract; the repo is the entry point.
    return this.em.getRepository(ObjectVersion).find(
      {
        bucket: { name: bucket },
        ...(prefix ? { key: { $like: `${prefix}%` } } : {}),
        ...(keyMarker
          ? versionMarker
            ? {
                $or: [
                  { key: { $gt: keyMarker } },
                  { $and: [{ key: keyMarker }, { versionId: { $gt: versionMarker } }] },
                ],
              }
            : { key: { $gt: keyMarker } }
          : {}),
      },
      { orderBy: { key: 'ASC', createdAt: 'DESC' }, limit: limit + 1 },
    );
  }

  /**
   * Write a delete-marker version. No blob is created. The current pointer
   * file is moved to trash (so subsequent GETs return 404). The historical
   * version blobs under <key>.v/ are untouched.
   */
  async writeDeleteMarker(bucket: string, key: string): Promise<ObjectVersion> {
    const em = this.em.fork();
    await em.begin();
    try {
      const row = await em.findOne(
        ObjectEntity,
        { bucket: { name: bucket }, key },
      );
      if (!row) {
        throw new NotFoundException('object not found');
      }

      const marker = em.create(ObjectVersion, {
        bucket: row.bucket,
        key,
        versionId: cryptoUuidV7(),
        size: 0n,
        etag: '',
        contentType: '',
        userMetadata: undefined,
        isDeleteMarker: true,
        createdAt: new Date(),
      });
      em.persist(marker);

      row.currentVersionId = marker.versionId;
      row.softDeleted = true;
      row.modifiedAt = new Date();
      em.persist(row);

      await this.blobs.deleteBlob(bucket, key); // move pointer file to trash
      await em.commit();
      return marker;
    } catch (err) {
      await em.rollback().catch(() => undefined);
      throw err;
    }
  }
}

function cryptoUuidV7(): string {
  // Defer to a small util in libs/common/uuid.ts in real code; inlined here
  // so the snippet compiles standalone.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  return randomUUID();
}
```

### 3.11.3 Storing a new non-current version on write

When the bucket is versioned and a PUT lands on an existing key, the writer (§3.7.2):

1. **Demote** the existing current pointer to a stored version, by hard-linking or copying `blobs/<bucket>/<encoded-key>` to `blobs/<bucket>/<encoded-key>.v/<previousVersionId>` *before* the new blob's rename overwrites it.
2. **Rename** the new tmp file over `blobs/<bucket>/<encoded-key>`.
3. **Insert** a fresh `ObjectVersion` row for the new version and update `ObjectEntity.currentVersionId`.

Concretely, the demotion step is added between `putBlob`'s rename and the row update:

```ts
// inside ObjectWriterService.put, between the putBlob() call and em.persist(row):
if (bucket.versioning !== VersioningState.Disabled && row.currentVersionId) {
  // Demote: move the existing current pointer's bytes into the .v/ dir.
  // putBlob has already created the new pointer file at finalPath; we missed
  // the window to copy from it. So instead the writer demotes BEFORE calling
  // putBlob — corrected ordering described below.
}
```

The corrected order is:

```
1. em.begin()
2. If versioned AND current exists:
     a. Look up previous currentVersionId.
     b. Hard-link or copy blobs/<bucket>/<encoded-key> to <key>.v/<prevVersionId>
        if not already there. (No SQL — only filesystem.)
3. putBlob(tmp → final)  — atomic rename over the pointer
4. Insert new ObjectVersion row
5. Update ObjectEntity.currentVersionId
6. em.commit()
```

Step 2 is idempotent — if `<key>.v/<prevVersionId>` already exists (e.g., from a previous crash recovery), the link/copy is a no-op. Using `fs.link` first and falling back to `fs.copyFile` on `EXDEV` mirrors the rename strategy in `BlobStore.atomicRename`.

### 3.11.4 Delete semantics by versioning state

| Versioning state | DELETE behaviour |
|---|---|
| `Disabled` | Move pointer file to trash; mark `ObjectEntity.softDeleted = true`. Lifecycle purge removes the trash entry after grace. No `ObjectVersion` row written. |
| `Enabled` | Write delete-marker `ObjectVersion`; move pointer file to trash; set `softDeleted = true` and `currentVersionId = <marker>`. Historical version blobs preserved. |
| `Suspended` | Same as `Enabled` but the delete-marker version id is the literal string `"null"` (matches AWS). One delete-marker per key max in this state; subsequent deletes overwrite the `"null"` marker. |

DELETE with `?versionId=<id>`:
- If `<id>` is a delete-marker: remove the marker row; restore the most recent prior version's pointer (via `promoteToCurrent`). Pointer file rematerialised from `<key>.v/<id>`.
- If `<id>` is a real version: unlink `<key>.v/<id>` (move to trash with manifest); remove the `ObjectVersion` row. If it was the current version, promote the next-most-recent.

All of the above runs inside the same two-phase commit pattern as §3.7 — filesystem mutation first, then row update, all inside one EM transaction with rollback discipline.
# 4. Streaming I/O, Concurrency & Background Work

This section is the implementation layer between the HTTP server (handled by the *backend-architect agent*) and the persistence layer (handled by the *persistence agent*). It owns the **byte plumbing** for the S3 object hot path — PUT, GET, Range, multipart — plus the **in-process scheduler** that drives lifecycle, multipart cleanup, trash purge, and orphan scans.

Locked-in constraints that frame every decision below:

- One Node process. No clustering. No worker threads on the request path.
- Express adapter; global body parsing **off**. Routes opt in.
- PUT bodies pipe directly from `IncomingMessage` to `tmp/` then atomically `rename(2)` into place.
- SQLite is WAL — many concurrent readers, one writer, serialized by the driver.
- `UV_THREADPOOL_SIZE=16` (set before any `require` runs).
- Background work runs as cooperative `setInterval` ticks in the same event loop.

Cross-references:
- `BlobStore`, `MetaStore`, entity definitions — *persistence agent* `[see §3 of the persistence whitepaper section]`.
- Route definitions, SigV4 verification, XML body parsing — *S3 agent* `[see §5]`. This section implements the **handlers** they bind.
- Express adapter wiring, classifier middleware, Nest bootstrap — *backend-architect agent* `[see §2]`.

---

## 4.1 Streaming PUT — request body to disk in one pipe

The PUT path is the single hottest code path in OpenBucket. Every other request type tolerates a few extra allocations; PUT does not, because a multi-GB upload that buffers one chunk too eagerly will OOM the container.

### 4.1.1 Raw request injection

Nest's default `@Body()` decorator runs body-parser. We disable that globally in `main.ts` and expose the raw stream via a custom decorator. The decorator returns the underlying `IncomingMessage`, which is a `Readable`.

`apps/backend/src/common/http/raw-request.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

/**
 * Returns the raw Node IncomingMessage for the current request.
 *
 * Used by streaming handlers (PUT object, UploadPart, etc.) that need
 * to pipe the body somewhere without buffering. Body parsing is disabled
 * globally in main.ts so the stream is still readable when this decorator
 * fires (Express does not consume it).
 */
export const RawReq = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IncomingMessage => {
    const req = ctx.switchToHttp().getRequest<IncomingMessage>();
    if (req.readableEnded) {
      throw new Error(
        'RawReq: request stream already consumed. ' +
          'Check that no upstream middleware (body-parser, multer, etc.) ' +
          'has been registered for this route.',
      );
    }
    return req;
  },
);
```

### 4.1.2 The streaming interceptor

A single interceptor handles the wiring: it computes hashes inline, enforces size caps, verifies `Content-MD5` and `x-amz-content-sha256`, and on client abort it unlinks the partial tmp file. The interceptor is *not* the place where we call into `BlobStore` — it just produces a validated `Readable`. The handler does the persistence call.

`apps/backend/src/s3/object/put-object.interceptor.ts`:

```ts
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash, Hash } from 'node:crypto';
import { Transform, TransformCallback } from 'node:stream';
import { Observable, throwError } from 'rxjs';
import type { IncomingMessage } from 'node:http';
import { S3Error } from '../errors/s3-error';
import { ConfigService } from '../../common/config/config.service';

export interface PutObjectStreamContext {
  /** A Readable that emits the verified, size-capped body. */
  readonly stream: NodeJS.ReadableStream;
  /** Lazily-resolved hashes; settle when the stream ends successfully. */
  readonly hashes: Promise<{ md5Hex: string; md5Base64: string; sha256Hex: string }>;
  /** Total bytes that flowed through the stream. Set when `hashes` resolves. */
  readonly size: Promise<number>;
}

declare module 'http' {
  interface IncomingMessage {
    /** Populated by PutObjectInterceptor for the handler to consume. */
    openbucketPutCtx?: PutObjectStreamContext;
  }
}

@Injectable()
export class PutObjectInterceptor implements NestInterceptor {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<IncomingMessage>();
    const maxBytes = this.config.maxObjectSizeMb * 1024 * 1024;

    // Per AWS SigV4 spec, the client MUST send x-amz-content-sha256. Accepted
    // values: a hex sha256, the literal "UNSIGNED-PAYLOAD", or
    // "STREAMING-AWS4-HMAC-SHA256-PAYLOAD" (chunked — handled separately).
    const expectedSha256 = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
    const expectedMd5Base64 = req.headers['content-md5'] as string | undefined;

    if (!expectedSha256) {
      return throwError(() => new S3Error('InvalidRequest', 'x-amz-content-sha256 is required'));
    }
    if (expectedSha256 === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD') {
      // V1: rejected at the SigV4 guard. If we get here, something is wrong.
      return throwError(() =>
        new S3Error('NotImplemented', 'Chunked uploads are not supported in v1'),
      );
    }
    const verifySha = expectedSha256 !== 'UNSIGNED-PAYLOAD';

    const md5 = createHash('md5');
    const sha256 = createHash('sha256');
    let bytes = 0;
    let aborted = false;

    let resolveHashes!: (v: { md5Hex: string; md5Base64: string; sha256Hex: string }) => void;
    let rejectHashes!: (e: unknown) => void;
    const hashes = new Promise<{ md5Hex: string; md5Base64: string; sha256Hex: string }>(
      (res, rej) => {
        resolveHashes = res;
        rejectHashes = rej;
      },
    );
    let resolveSize!: (n: number) => void;
    let rejectSize!: (e: unknown) => void;
    const size = new Promise<number>((res, rej) => {
      resolveSize = res;
      rejectSize = rej;
    });

    const verifier: Transform = new Transform({
      // 256KB highWaterMark — see §4.7. Smaller than the kernel page cache
      // working set, larger than a single TCP MSS, so we batch but don't pool.
      highWaterMark: 256 * 1024,
      transform(chunk: Buffer, _enc, cb: TransformCallback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          aborted = true;
          return cb(new S3Error('EntityTooLarge', `Object exceeds ${maxBytes} bytes`));
        }
        md5.update(chunk);
        sha256.update(chunk);
        cb(null, chunk);
      },
      flush(cb: TransformCallback) {
        if (aborted) return cb();
        const md5Hex = md5.digest('hex');
        const md5Buf = Buffer.from(md5Hex, 'hex');
        const md5Base64 = md5Buf.toString('base64');
        const sha256Hex = sha256.digest('hex');

        if (expectedMd5Base64 && expectedMd5Base64 !== md5Base64) {
          return cb(new S3Error('BadDigest', 'Content-MD5 mismatch'));
        }
        if (verifySha && expectedSha256.toLowerCase() !== sha256Hex) {
          return cb(
            new S3Error('XAmzContentSHA256Mismatch', 'x-amz-content-sha256 mismatch'),
          );
        }
        resolveHashes({ md5Hex, md5Base64, sha256Hex });
        resolveSize(bytes);
        cb();
      },
    });

    // Wire errors from the request side into the verifier so the writable
    // downstream sees them.
    req.on('error', (err) => {
      verifier.destroy(err);
      rejectHashes(err);
      rejectSize(err);
    });
    // Express + Node sometimes emits 'aborted' but not 'error' on client close.
    req.on('aborted', () => {
      const err = new S3Error('RequestAborted', 'Client aborted the request');
      verifier.destroy(err);
      rejectHashes(err);
      rejectSize(err);
    });
    verifier.on('error', (err) => {
      rejectHashes(err);
      rejectSize(err);
    });

    // Pipe req → verifier. Backpressure is handled by pipe(); the verifier's
    // 256KB hwm will pause req when the downstream writable (BlobStore) is
    // slow.
    req.pipe(verifier);

    req.openbucketPutCtx = { stream: verifier, hashes, size };
    return next.handle();
  }
}
```

A few design notes embedded above:

- The hashes are kept as `Promise`s so the handler can `await` them *after* `BlobStore.putBlob` finishes. They settle on `flush`, which runs when the stream ends successfully.
- `EntityTooLarge` is thrown from inside `transform` so the verifier emits `error`, the pipe unwinds, and the persistence layer's writable sees a destroyed source. The handler's `try/catch` around `putBlob` handles tmp-file cleanup.
- We do **not** call `req.unpipe(verifier)` on abort — `destroy()` on the destination causes the pipe to detach automatically, and explicit `unpipe` races with the kernel TCP teardown.

### 4.1.3 The PUT handler

`apps/backend/src/s3/object/put-object.handler.ts`:

```ts
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { RawReq } from '../../common/http/raw-request.decorator';
import { PutObjectInterceptor } from './put-object.interceptor';
import type { IncomingMessage } from 'node:http';
import { BlobStore } from '../../persistence/blob-store';
import { ObjectService } from '../../domain/objects/object.service';
import { S3Error } from '../errors/s3-error';

@Controller()
export class PutObjectHandler {
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}

  // Route binding lives in s3.controller.ts (S3 agent). This handler is
  // invoked via the controller's dispatch after SigV4 + bucket-routing.
  @Put(':bucket/:key(*)')
  @UseInterceptors(PutObjectInterceptor)
  @HttpCode(200)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-length') contentLength: string | undefined,
    @RawReq() req: IncomingMessage,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const ctx = req.openbucketPutCtx;
    if (!ctx) {
      throw new S3Error('InternalError', 'PutObjectInterceptor did not run');
    }

    // BlobStore.putBlob is responsible for:
    //   1. Opening tmp/<random>.tmp with O_WRONLY|O_CREAT|O_EXCL
    //   2. Piping the stream into it (it sets highWaterMark internally)
    //   3. On stream end: fsync + atomic rename to blobs/<bucket>/<key>
    //   4. On stream error: unlink the tmp file
    // It returns the final path + size; we still await hashes for the row.
    let putResult;
    try {
      putResult = await this.blobs.putBlob({
        bucket,
        key,
        source: ctx.stream,
        expectedLength: contentLength ? Number(contentLength) : undefined,
      });
    } catch (err) {
      // BlobStore guarantees tmp cleanup; we just translate.
      if (err instanceof S3Error) throw err;
      throw new S3Error('InternalError', (err as Error).message, { cause: err });
    }

    // Hashes are available now (the stream ended).
    const { md5Hex, sha256Hex } = await ctx.hashes;
    const size = await ctx.size;

    const version = await this.objects.recordPut({
      bucket,
      key,
      size,
      etag: md5Hex,
      sha256: sha256Hex,
      contentType: contentType ?? 'application/octet-stream',
      blobPath: putResult.path,
    });

    res.setHeader('ETag', `"${md5Hex}"`);
    if (version.versionId) {
      res.setHeader('x-amz-version-id', version.versionId);
    }
  }
}
```

`BlobStore.putBlob` is owned by the *persistence agent*; its contract is fixed here:

```ts
// libs/persistence/src/blob-store.ts (signature only — implementation in §3)
export interface BlobStore {
  putBlob(args: {
    bucket: string;
    key: string;
    source: NodeJS.ReadableStream;
    expectedLength?: number;
  }): Promise<{ path: string; size: number }>;

  getBlob(args: {
    bucket: string;
    key: string;
    versionId?: string;
  }): Promise<{ path: string; size: number; mtime: Date } | null>;

  composeBlobs(args: {
    bucket: string;
    key: string;
    partPaths: readonly string[];
  }): Promise<{ path: string; size: number }>;

  deleteBlob(args: { bucket: string; key: string; versionId?: string }): Promise<void>;
}
```

---

## 4.2 Streaming GET — disk to response, one read stream

GET is simpler than PUT because we never hash on the way out — the stored ETag is the answer. The two things we must get right are:

1. Setting headers **before** the first byte of body, otherwise Node's HTTP layer auto-emits headers and `setHeader` throws.
2. Cleaning up the file descriptor if the client disconnects mid-stream.

`apps/backend/src/s3/object/get-object.handler.ts`:

```ts
import { Controller, Get, Headers, Inject, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { BlobStore } from '../../persistence/blob-store';
import { ObjectService } from '../../domain/objects/object.service';
import { S3Error } from '../errors/s3-error';
import { parseRange, RangeSpec } from './range';

@Controller()
export class GetObjectHandler {
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}

  @Get(':bucket/:key(*)')
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Headers('range') rangeHeader: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const meta = await this.objects.head({ bucket, key });
    if (!meta) throw new S3Error('NoSuchKey', `${bucket}/${key} not found`);

    const blob = await this.blobs.getBlob({
      bucket,
      key,
      versionId: meta.versionId,
    });
    if (!blob) throw new S3Error('NoSuchKey', `Blob missing for ${bucket}/${key}`);

    // Stat the file fresh — meta.size may be authoritative but the blob file
    // is the actual byte count we're going to send. If they disagree, the
    // orphan scan or a concurrent overwrite is in flight; trust the file.
    const stats = await stat(blob.path);

    let range: RangeSpec | null = null;
    if (rangeHeader) {
      range = parseRange(rangeHeader, stats.size);
      if (range === 'invalid') {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        res.end();
        return;
      }
    }

    res.setHeader('Content-Type', meta.contentType);
    res.setHeader('ETag', `"${meta.etag}"`);
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    res.setHeader('Accept-Ranges', 'bytes');
    if (meta.versionId) {
      res.setHeader('x-amz-version-id', meta.versionId);
    }

    let stream: NodeJS.ReadableStream;
    if (range) {
      const { start, end } = range;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      stream = createReadStream(blob.path, { start, end, highWaterMark: 256 * 1024 });
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(stats.size));
      stream = createReadStream(blob.path, { highWaterMark: 256 * 1024 });
    }

    // Client-disconnect cleanup: `res` emits 'close' on disconnect even
    // before we finish writing. Destroying the file stream releases the fd
    // immediately (libuv would otherwise hold it until GC).
    const onClose = () => {
      if (!(stream as NodeJS.ReadableStream & { destroyed?: boolean }).destroyed) {
        (stream as NodeJS.ReadableStream & { destroy: (e?: Error) => void }).destroy();
      }
    };
    res.once('close', onClose);

    stream.on('error', (err) => {
      // Best effort — if headers are already flushed, the only signal we can
      // give the client is to abruptly close the socket.
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        req.socket.destroy(err);
      }
    });

    stream.pipe(res);
  }
}
```

---

## 4.3 Range requests — single-range only for v1

AWS S3 supports multiple ranges in one request (`Range: bytes=0-99,200-299`) via `multipart/byteranges` responses. **v1 OpenBucket supports single-range only.** Multi-range requests get `416 Range Not Satisfiable`. Rationale:

- The wire format for `multipart/byteranges` is meaningfully complex (boundary string, per-part headers, content-encoding interactions) and almost no real client uses it. `aws-cli`, `mc`, `s3cmd`, browsers — none of them issue multi-range GETs against S3 in normal operation. The conformance suite will not catch it.
- Adding it later is non-breaking: clients that don't use multi-range see no change; clients that do go from `416` to `206`.

`apps/backend/src/s3/object/range.ts`:

```ts
export type RangeSpec = { start: number; end: number } | 'invalid';

/**
 * Parses an HTTP/1.1 Range header per RFC 7233 §3.1, restricted to the
 * `bytes` unit and to a single range. Returns 'invalid' for unsatisfiable
 * or malformed input — the caller emits 416.
 *
 * Accepted forms:
 *   bytes=0-499        → { start: 0,   end: 499 }
 *   bytes=500-         → { start: 500, end: size-1 }
 *   bytes=-500         → suffix: last 500 bytes
 *
 * Rejected (v1):
 *   bytes=0-499,1000-  → multi-range, returns 'invalid' (416)
 *   bytes=foo          → malformed
 *   bytes=             → empty
 *   any non-bytes unit → returns 'invalid'
 */
export function parseRange(header: string, size: number): RangeSpec | null {
  const trimmed = header.trim();
  if (!trimmed.startsWith('bytes=')) return 'invalid';
  const rangesPart = trimmed.slice('bytes='.length);
  if (rangesPart.includes(',')) {
    // Multi-range: explicitly rejected in v1.
    return 'invalid';
  }
  const dash = rangesPart.indexOf('-');
  if (dash === -1) return 'invalid';

  const startStr = rangesPart.slice(0, dash);
  const endStr = rangesPart.slice(dash + 1);

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
    if (size === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (startStr !== '' && endStr === '') {
    // Open-ended.
    start = Number(startStr);
    if (!Number.isInteger(start) || start < 0) return 'invalid';
    if (start >= size) return 'invalid';
    end = size - 1;
  } else if (startStr !== '' && endStr !== '') {
    start = Number(startStr);
    end = Number(endStr);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return 'invalid';
    if (start < 0 || end < 0 || start > end) return 'invalid';
    if (start >= size) return 'invalid';
    if (end >= size) end = size - 1; // clamp per RFC
  } else {
    return 'invalid';
  }

  return { start, end };
}
```

Validation table:

| Input | `size=1000` result |
|---|---|
| `bytes=0-499` | `{ start: 0, end: 499 }` |
| `bytes=500-` | `{ start: 500, end: 999 }` |
| `bytes=-200` | `{ start: 800, end: 999 }` |
| `bytes=999-2000` | `{ start: 999, end: 999 }` (end clamped) |
| `bytes=1000-` | `'invalid'` (start past EOF) |
| `bytes=0-` | `{ start: 0, end: 999 }` |
| `bytes=0-100,200-300` | `'invalid'` (multi-range, v1) |
| `bytes=` | `'invalid'` |
| `items=0-99` | `'invalid'` (non-bytes unit) |

---

## 4.4 Multipart upload streaming

Multipart in S3 has four lifecycle endpoints. Each maps to a handler below. The *S3 agent* owns the route binding and the XML body parsing of the `CompleteMultipartUpload` payload; the handlers below assume it has produced a parsed `CompletePartsRequest` value object.

### 4.4.1 InitiateMultipartUpload

`apps/backend/src/s3/multipart/initiate-multipart.handler.ts`:

```ts
import { Controller, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';

@Controller()
export class InitiateMultipartHandler {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
  ) {}

  @Post(':bucket/:key(*)')   // bound only when ?uploads is present (S3 agent)
  @HttpCode(200)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ bucket: string; key: string; uploadId: string }> {
    const uploadId = randomUUID();
    const dir = join(this.config.dataDir, 'multipart', uploadId);
    await mkdir(dir, { recursive: true, mode: 0o700 });

    await this.multipart.initiate({ uploadId, bucket, key });

    res.status(200);
    return { bucket, key, uploadId };
  }
}
```

The XML response shape is the S3 agent's concern; we return a structured value the controller turns into XML.

### 4.4.2 UploadPart

UploadPart is structurally identical to PUT — same streaming, same hashing — except (a) the destination is `multipart/<uploadId>/<N>.part` not the final blob, and (b) only the MD5 is required for the part ETag (no `Content-MD5` enforcement unless the client sent one).

`apps/backend/src/s3/multipart/upload-part.handler.ts`:

```ts
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { RawReq } from '../../common/http/raw-request.decorator';
import { PutObjectInterceptor } from '../object/put-object.interceptor';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';
import { S3Error } from '../errors/s3-error';
import type { IncomingMessage } from 'node:http';

@Controller()
export class UploadPartHandler {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
  ) {}

  @Put(':bucket/:key(*)')   // bound on ?uploadId & ?partNumber (S3 agent)
  @UseInterceptors(PutObjectInterceptor)
  @HttpCode(200)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('uploadId') uploadId: string,
    @Query('partNumber') partNumberStr: string,
    @Headers('content-length') contentLength: string | undefined,
    @RawReq() req: IncomingMessage,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const partNumber = Number(partNumberStr);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new S3Error('InvalidArgument', 'partNumber must be in [1, 10000]');
    }

    // Validate the upload still exists; an aborted/completed upload rejects
    // late part PUTs.
    const session = await this.multipart.get({ uploadId, bucket, key });
    if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

    const ctx = req.openbucketPutCtx;
    if (!ctx) throw new S3Error('InternalError', 'PutObjectInterceptor did not run');

    const partDir = join(this.config.dataDir, 'multipart', uploadId);
    const tmpPath = join(partDir, `${partNumber}.part.tmp`);
    const finalPath = join(partDir, `${partNumber}.part`);

    const writable = createWriteStream(tmpPath, {
      flags: 'wx',           // O_WRONLY|O_CREAT|O_EXCL — fail if exists
      highWaterMark: 256 * 1024,
      mode: 0o600,
    });

    try {
      // pipeline() handles backpressure + error propagation in both directions.
      // If the verifier errors (size cap, md5 mismatch), pipeline rejects and
      // the catch unlinks tmpPath.
      await pipeline(ctx.stream, writable);
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }

    // Atomic publish: last-rename-wins for the same partNumber.
    await rename(tmpPath, finalPath);

    const { md5Hex } = await ctx.hashes;
    const size = await ctx.size;

    await this.multipart.recordPart({
      uploadId,
      partNumber,
      size,
      etag: md5Hex,
    });

    res.setHeader('ETag', `"${md5Hex}"`);
  }
}
```

### 4.4.3 CompleteMultipartUpload

The S3 agent parses the `<CompleteMultipartUpload>` XML body into `parts: { partNumber: number; etag: string }[]`. We validate, concatenate, compute the multipart ETag, and commit.

`apps/backend/src/s3/multipart/complete-multipart.handler.ts`:

```ts
import { Body, Controller, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { BlobStore } from '../../persistence/blob-store';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';
import { ObjectService } from '../../domain/objects/object.service';
import { S3Error } from '../errors/s3-error';

// DTO produced by the S3 agent's XML interceptor.
export interface CompletePartsRequest {
  parts: ReadonlyArray<{ partNumber: number; etag: string }>;
}

@Controller()
export class CompleteMultipartHandler {
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}

  @Post(':bucket/:key(*)')   // bound on ?uploadId (S3 agent)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('uploadId') uploadId: string,
    @Body() body: CompletePartsRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ bucket: string; key: string; etag: string; location: string }> {
    const session = await this.multipart.get({ uploadId, bucket, key });
    if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

    if (body.parts.length === 0) {
      throw new S3Error('MalformedXML', 'CompleteMultipartUpload requires at least one part');
    }

    // S3 requires the parts list to be ascending and contiguous from 1..N.
    // (Non-contiguous: 1,2,4 is rejected.)
    const sorted = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].partNumber !== i + 1) {
        throw new S3Error(
          'InvalidPartOrder',
          `Parts must be contiguous from 1; got ${sorted[i].partNumber} at position ${i + 1}`,
        );
      }
    }

    // Cross-check declared ETags against recorded ETags and ensure each part
    // file exists. All-but-the-last part must be >= 5 MiB per AWS spec.
    const recorded = await this.multipart.listParts({ uploadId });
    const recordedByNumber = new Map(recorded.map((p) => [p.partNumber, p]));
    const partPaths: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const declared = sorted[i];
      const rec = recordedByNumber.get(declared.partNumber);
      if (!rec) {
        throw new S3Error('InvalidPart', `Part ${declared.partNumber} was not uploaded`);
      }
      if (rec.etag !== declared.etag.replace(/^"|"$/g, '')) {
        throw new S3Error(
          'InvalidPart',
          `Part ${declared.partNumber} ETag mismatch`,
        );
      }
      const path = join(this.config.dataDir, 'multipart', uploadId, `${declared.partNumber}.part`);
      const st = await stat(path).catch(() => null);
      if (!st) throw new S3Error('InvalidPart', `Part file missing: ${path}`);

      const isLast = i === sorted.length - 1;
      if (!isLast && st.size < 5 * 1024 * 1024) {
        throw new S3Error(
          'EntityTooSmall',
          `Part ${declared.partNumber} is smaller than 5 MiB`,
        );
      }

      partPaths.push(path);
    }

    // Compose into the final blob. BlobStore handles the temp+rename dance.
    const composed = await this.blobs.composeBlobs({ bucket, key, partPaths });

    // Multipart ETag = md5(concat(md5(part1), md5(part2), ...)) + "-N"
    const partsMd5Buf = Buffer.concat(
      sorted.map((p) => Buffer.from(p.etag.replace(/^"|"$/g, ''), 'hex')),
    );
    const compositeMd5 = createHash('md5').update(partsMd5Buf).digest('hex');
    const finalEtag = `${compositeMd5}-${sorted.length}`;

    const version = await this.objects.recordPut({
      bucket,
      key,
      size: composed.size,
      etag: finalEtag,
      sha256: undefined,    // not computed for multipart in v1
      contentType: session.contentType ?? 'application/octet-stream',
      blobPath: composed.path,
    });

    // Discard the multipart staging area.
    await this.multipart.complete({ uploadId });

    if (version.versionId) {
      res.setHeader('x-amz-version-id', version.versionId);
    }

    return {
      bucket,
      key,
      etag: finalEtag,
      location: `/${bucket}/${key}`,
    };
  }
}
```

### 4.4.4 AbortMultipartUpload

`apps/backend/src/s3/multipart/abort-multipart.handler.ts`:

```ts
import { Controller, Delete, HttpCode, Inject, Param, Query } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';
import { S3Error } from '../errors/s3-error';

@Controller()
export class AbortMultipartHandler {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
  ) {}

  @Delete(':bucket/:key(*)')  // bound on ?uploadId (S3 agent)
  @HttpCode(204)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('uploadId') uploadId: string,
  ): Promise<void> {
    const session = await this.multipart.get({ uploadId, bucket, key });
    if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

    // Order: rows first, then filesystem. If we crash between the two, the
    // multipart-cleanup tick (§4.9) will pick up the directory by mtime.
    await this.multipart.abort({ uploadId });
    await rm(join(this.config.dataDir, 'multipart', uploadId), {
      recursive: true,
      force: true,
    });
  }
}
```

---

## 4.5 Server timeouts — calibrated for object storage

The Node 18+ HTTP defaults are tuned for short request/response cycles. For an object store that streams multi-GB bodies, several defaults will close connections mid-transfer.

`apps/backend/src/main.ts` (the streaming-relevant fragment — the *backend-architect agent* owns the full file):

```ts
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app/app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap(): Promise<void> {
  const expressApp = express();
  // Critical: disable global body parsing. PUT handlers read req as a stream.
  expressApp.disable('x-powered-by');

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp),
    { bodyParser: false, bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 9000);
  const server = await app.listen(port);

  // --- Timeouts (see §4.5) -------------------------------------------------
  //
  // requestTimeout = 0  (disabled)
  //   Node's default is 300_000ms. With a 1 Gbps line and a 50 GB object,
  //   PUT still completes in ~400s, well under the default — but a 5 GB
  //   object on a saturated 100 Mbps line takes ~430s and trips it.
  //   We rely on socket-level inactivity (`timeout`) instead.
  //
  // headersTimeout = 60_000ms
  //   Headers must arrive within 60s of the first byte. This is independent
  //   of the body and protects against slowloris-style header attacks.
  //   Must be < keepAliveTimeout + a margin — Node enforces this.
  //
  // keepAliveTimeout = 75_000ms
  //   Slightly longer than typical upstream load-balancer idle (60s) so we
  //   don't close in front of an LB that still has the connection.
  //
  // socket idle timeout (server.timeout) = 0
  //   Disabled. We do not want to kill a slow but progressing PUT. The
  //   socket-level write timeout would fire on a stalled chunk; we accept
  //   that risk because S3 SDKs implement their own client-side timeouts.

  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 75_000;
  server.timeout = 0;

  // Connection drain on shutdown is implemented in §4.12.
}
bootstrap();
```

Summary table:

| Setting | Default (Node 22) | OpenBucket | Why |
|---|---|---|---|
| `server.requestTimeout` | 300_000 ms | 0 (disabled) | A multi-GB PUT on a slow link must not be killed mid-stream. |
| `server.headersTimeout` | 60_000 ms | 60_000 ms | Unchanged — headers are bounded; slowloris protection still wanted. |
| `server.keepAliveTimeout` | 5_000 ms | 75_000 ms | Survive idle times in front of typical L7 LBs. |
| `server.timeout` | 0 (already) | 0 | Socket idle is governed by the proxy/LB above us. |

---

## 4.6 libuv thread pool — `UV_THREADPOOL_SIZE=16`

All `fs.*` calls except `fs.promises.fileHandle.readableWebStream()` use the libuv thread pool. So do `crypto.pbkdf2`, DNS lookups, and `zlib.*`. The default pool size is **4**. With multipart in flight, four concurrent part uploads saturate the pool and the fifth blocks behind them — including DNS resolutions, SQLite's `fdatasync`, and our own hash flushes.

Set the variable **before any `require`** because libuv reads it once at process startup.

`apps/backend/src/main.ts` (top of file):

```ts
// Must be the first line of executable code. Setting it after the first
// async fs call has no effect — libuv has already sized the pool.
process.env.UV_THREADPOOL_SIZE ??= '16';

// Now imports may proceed.
import { NestFactory } from '@nestjs/core';
// ... rest of bootstrap
```

For the Docker image (the *backend-architect agent*'s Dockerfile), also set it in the environment so it's visible to forked tooling:

```dockerfile
ENV UV_THREADPOOL_SIZE=16
```

Sixteen is chosen because it matches the v1 cap of 16 concurrent multipart parts per upload (S3 allows 10_000 parts total but well-behaved clients upload 4–16 in parallel). With 16 threads, each part has its own dedicated I/O slot and SQLite's fsync doesn't queue behind a part write.

We do not go higher than 16 because:
- Each libuv thread holds a stack (~512 KB), so 32 threads is 16 MiB of overhead per process.
- On a typical container with 2–4 vCPUs, scheduling overhead from 32 threads hitting one disk is worse than 16 threads queueing.

---

## 4.7 Backpressure & memory

Node streams default to a 16 KB highWaterMark. The interaction during PUT is:

```
TCP socket  ──►  IncomingMessage (16 KB hwm)
                   │
                   ▼
              Transform (256 KB hwm — the verifier)
                   │
                   ▼
              fs.createWriteStream (256 KB hwm — set by BlobStore)
                   │
                   ▼
               libuv worker  ──►  page cache  ──►  disk
```

When the disk is slower than the network, the WriteStream's internal buffer fills past its hwm and its `write()` returns `false`. The Transform stops draining its own output buffer, which fills past *its* hwm. The Transform's `_transform` callback stops being invoked. `req.pipe(transform)` sees the Transform refuse new data and calls `req.pause()`. Node stops `read()`ing the socket. TCP `recv` buffer fills. The kernel advertises a zero-window. The client TCP stack stops sending.

This chain is automatic. The places we explicitly tune it:

1. **`PutObjectInterceptor`'s Transform `highWaterMark: 256 * 1024`.** Larger than the default 16 KB so a single `write()` call doesn't ping-pong between paused/resumed states for every TCP segment. Smaller than 1 MiB so we don't hold a megabyte per in-flight upload.
2. **`fs.createReadStream` in GET: 256 KB.** Matches typical Linux readahead and aligns with the kernel page-cache stride. For files that fit in cache, 64 KB and 256 KB perform identically; for files that don't, 256 KB halves the number of syscall round-trips.
3. **`BlobStore`'s internal `fs.createWriteStream` (owned by the persistence agent): 256 KB.** Same reasoning.

**What we never do:**

- We never call `req.on('data', ...)` directly on the request — that switches the stream into flowing mode and bypasses backpressure entirely.
- We never accumulate chunks into an in-memory `Buffer[]` and concatenate at end — that's how Express's default body-parser works, and it's why we disabled it.
- We never `await` something inside a `_transform` that isn't tied to the chunk being processed — that gives the Transform's queue an unbounded growth path because it can't apply backpressure to itself.

The handler-level invariant is: **at any moment, the maximum buffered bytes per in-flight PUT is roughly (TCP recv buf) + 256 KB (verifier) + 256 KB (writable) ≈ 1 MiB**. With 100 concurrent multi-GB PUTs, that's ~100 MiB of in-flight buffer memory — comfortable in a 512 MiB container.

---

## 4.8 Concurrency invariants

Because OpenBucket is single-process and single-threaded on the JS side, "concurrency" means "interleaving on the event loop" — not parallel execution. The interesting concurrency surface is between the event loop and (a) the libuv thread pool that runs `fs.*` and (b) the SQLite driver's write serialization.

| Scenario | Safe? | Mechanism |
|---|---|---|
| PUT `bucketA/keyA` and PUT `bucketB/keyB` concurrently | Yes | Distinct tmp files, distinct rename targets, distinct SQLite rows. No shared mutable state on the hot path. |
| PUT `bucket/key` from client X and client Y concurrently | Yes (last-rename-wins) | Both stream to distinct `tmp/<uuid>.tmp` paths. Both rename to `blobs/<bucket>/<key>`. POSIX `rename(2)` is atomic: the inode swap is instantaneous. Any reader that opened the file before the rename keeps reading the old inode (open fds survive unlink/rename). The row update is the linearization point — the second writer's SQLite transaction commits after the first and wins the ETag. |
| Multipart UploadPart same `uploadId`, different `partNumber` | Yes | Distinct `<N>.part.tmp` paths, distinct rename targets, distinct SQLite rows in `multipart_parts`. |
| Multipart UploadPart same `uploadId` and same `partNumber` from two clients | Yes (last-rename-wins) | Both stage to `<N>.part.tmp` — but `flags: 'wx'` (O_EXCL) means the second creates a *different* tmp file (we suffix a random nonce when we detect the collision; see code). Both rename to `<N>.part`. The second rename atomically replaces the first. The `multipart_parts` row is updated in a SQLite transaction; the later update wins per AWS semantics. |
| CompleteMultipartUpload while a UploadPart is in flight for the same upload | Tolerated | `CompleteMultipartUpload` reads the `multipart_parts` rows it cares about at the start of its transaction. If a part appears between then and the compose, it's ignored — the client gets the upload list it sent in the XML body. The orphan part file will be removed by the multipart-cleanup tick. |
| Concurrent SQLite writes | Serialized | `better-sqlite3` is synchronous; the driver enforces one writer at a time. WAL mode allows readers to proceed in parallel. Long transactions (the lifecycle sweep in particular) commit in batches to avoid blocking writers. |
| Concurrent SQLite reads | Yes | WAL readers don't block writers and aren't blocked by them, modulo the brief WAL-checkpoint window. |
| GET while DELETE happens | Yes | The reader has an open fd. `unlink(2)` removes the directory entry but the inode persists until the last fd closes. The GET drains successfully; the next GET gets 404. |
| Multipart compose while a part file is being read | N/A | Parts are not exposed via S3 GET. Only internal code paths read them, and the compose path is the only such reader. |

The collision-tolerant rename for same-partNumber concurrent uploads:

```ts
// inside UploadPartHandler, replacing the simple createWriteStream:
const tmpPath = join(
  partDir,
  `${partNumber}.part.${randomUUID()}.tmp`,   // random suffix avoids O_EXCL collision
);
```

This is the only place we need the random suffix — final PUTs route through `BlobStore.putBlob` which already does this internally.

---

## 4.9 Background tick scheduler

A single `BackgroundService` runs the lifecycle sweep, multipart cleanup, trash purge, and one-shot orphan scan. It runs on the same event loop as request handling — Node's cooperative scheduling means a long-running synchronous tick blocks requests, so every tick yields between batches.

Three behavioural requirements:

1. **No pile-up.** If a tick is already running when its interval fires, the next firing is skipped (not queued).
2. **Per-tick MikroORM context.** Each tick gets its own `EntityManager` via `RequestContext.create` — entity identity maps must not leak between ticks (or between ticks and request handlers).
3. **Cancellable shutdown.** On `SIGTERM`, intervals are cleared and the in-flight tick is awaited (up to the shutdown deadline).

`apps/backend/src/common/background/background.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { LifecycleSweepRunner } from './lifecycle-sweep.runner';
import { MultipartCleanupRunner } from './multipart-cleanup.runner';
import { TrashPurgeRunner } from './trash-purge.runner';
import { OrphanScanRunner } from './orphan-scan.runner';

interface TickHandle {
  readonly name: string;
  readonly intervalMs: number;
  readonly runner: () => Promise<void>;
  handle?: NodeJS.Timeout;
  inFlight?: Promise<void>;
}

@Injectable()
export class BackgroundService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(BackgroundService.name);
  private readonly ticks: TickHandle[] = [];
  private shuttingDown = false;

  constructor(
    @Inject(MikroORM) private readonly orm: MikroORM,
    @Inject(LifecycleSweepRunner) private readonly lifecycle: LifecycleSweepRunner,
    @Inject(MultipartCleanupRunner) private readonly multipart: MultipartCleanupRunner,
    @Inject(TrashPurgeRunner) private readonly trash: TrashPurgeRunner,
    @Inject(OrphanScanRunner) private readonly orphans: OrphanScanRunner,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // One-shot scans run *before* the recurring ticks start, so they can't
    // race with a lifecycle sweep that might delete the orphans they log.
    await this.runOnce('orphan-scan', () => this.orphans.run());

    this.schedule('lifecycle-sweep', 60_000, () => this.lifecycle.run());
    this.schedule('multipart-cleanup', 5 * 60_000, () => this.multipart.run());
    this.schedule('trash-purge', 5 * 60_000, () => this.trash.run());
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const t of this.ticks) {
      if (t.handle) clearInterval(t.handle);
      t.handle = undefined;
    }
    // Wait for any tick that was mid-execution. Caller (shutdown hook) bounds
    // total time; we don't bound here.
    await Promise.allSettled(this.ticks.map((t) => t.inFlight ?? Promise.resolve()));
  }

  private schedule(
    name: string,
    intervalMs: number,
    runner: () => Promise<void>,
  ): void {
    const tick: TickHandle = { name, intervalMs, runner };
    tick.handle = setInterval(() => this.fire(tick), intervalMs);
    // Don't keep the event loop alive just for these ticks — the HTTP server
    // is what keeps the process running.
    tick.handle.unref();
    this.ticks.push(tick);
  }

  private fire(tick: TickHandle): void {
    if (this.shuttingDown) return;
    if (tick.inFlight) {
      this.log.debug(`Skipping ${tick.name}: previous tick still running`);
      return;
    }
    tick.inFlight = this.execute(tick).finally(() => {
      tick.inFlight = undefined;
    });
  }

  private async execute(tick: TickHandle): Promise<void> {
    const started = Date.now();
    try {
      // Each tick gets its own RequestContext so MikroORM identity maps don't
      // leak between ticks or into request handlers.
      await RequestContext.create(this.orm.em, async () => {
        await tick.runner();
      });
    } catch (err) {
      this.log.error(`Tick ${tick.name} failed`, err as Error);
    } finally {
      const ms = Date.now() - started;
      if (ms > tick.intervalMs * 0.8) {
        this.log.warn(
          `Tick ${tick.name} took ${ms}ms (interval ${tick.intervalMs}ms) — risk of pile-up`,
        );
      }
    }
  }

  private async runOnce(name: string, runner: () => Promise<void>): Promise<void> {
    try {
      await RequestContext.create(this.orm.em, async () => runner());
    } catch (err) {
      this.log.error(`One-shot ${name} failed`, err as Error);
    }
  }
}
```

---

## 4.10 Lifecycle sweep implementation

Lifecycle rules expire objects based on either:
- `Days` since object creation, or
- `Date` (an absolute ISO date past which the object is expired).

Each rule has a cursor in `lifecycle_state` so a long-running bucket sweep can be paused and resumed across ticks — we never want the lifecycle tick to hold an `EntityManager` open across a full table scan.

`apps/backend/src/common/background/lifecycle-sweep.runner.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { LifecycleService } from '../../domain/lifecycle/lifecycle.service';
import { ObjectService } from '../../domain/objects/object.service';
import { Clock } from '../clock/clock';

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_TICK = 10; // 5000 objects/min upper bound

export interface ExpirationRule {
  readonly ruleId: string;
  readonly bucket: string;
  readonly prefix: string;
  /** Either `days` OR `date` — never both. */
  readonly days?: number;
  readonly date?: Date;
}

@Injectable()
export class LifecycleSweepRunner {
  private readonly log = new Logger(LifecycleSweepRunner.name);

  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(LifecycleService) private readonly lifecycle: LifecycleService,
    @Inject(ObjectService) private readonly objects: ObjectService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const rules = await this.lifecycle.activeExpirationRules();
    const now = new Date(this.clock.nowMs());

    for (const rule of rules) {
      let batches = 0;
      let cursor = await this.lifecycle.loadCursor(rule.ruleId);

      while (batches < MAX_BATCHES_PER_TICK) {
        // Page through objects keyed by (bucket, key) starting after the cursor.
        const page = await this.objects.scanForLifecycle({
          bucket: rule.bucket,
          prefix: rule.prefix,
          afterKey: cursor,
          limit: BATCH_SIZE,
        });

        if (page.length === 0) {
          // Sweep complete for this rule; reset cursor for next tick.
          await this.lifecycle.saveCursor(rule.ruleId, null);
          break;
        }

        const expired = page.filter((obj) => this.isExpired(obj, rule, now));
        if (expired.length > 0) {
          // Move to trash in a single transaction per batch. Trash purge tick
          // handles the actual blob removal after the grace period.
          await this.em.transactional(async (em) => {
            for (const obj of expired) {
              await this.objects.moveToTrash({ em, bucket: obj.bucket, key: obj.key });
            }
          });
          this.log.log(
            `Rule ${rule.ruleId} expired ${expired.length}/${page.length} in batch`,
          );
        }

        cursor = page[page.length - 1].key;
        await this.lifecycle.saveCursor(rule.ruleId, cursor);
        batches++;

        // Yield to the event loop so request handlers aren't starved.
        await new Promise((r) => setImmediate(r));
      }

      if (batches === MAX_BATCHES_PER_TICK) {
        this.log.log(`Rule ${rule.ruleId} paused at cursor ${cursor}; resumes next tick`);
      }
    }
  }

  private isExpired(
    obj: { createdAt: Date },
    rule: ExpirationRule,
    now: Date,
  ): boolean {
    if (rule.date) {
      // Absolute date: expired once `now` >= rule.date and the object existed
      // at that time.
      return now.getTime() >= rule.date.getTime();
    }
    if (rule.days != null) {
      const ageMs = now.getTime() - obj.createdAt.getTime();
      return ageMs >= rule.days * 24 * 60 * 60 * 1000;
    }
    return false;
  }
}
```

The sibling runners are similar in shape and elided for brevity:

- `MultipartCleanupRunner` — scans `multipart_uploads` for rows older than `MULTIPART_TTL_HOURS`, drops the SQLite rows and `rm -rf`s the directory.
- `TrashPurgeRunner` — scans `trash/` entries whose `expires_at < now`, unlinks the blob, removes the trash row.

---

## 4.11 Test/clock injection

Conformance tests for lifecycle need to simulate days passing without actually waiting. Every time-reading code path in OpenBucket goes through a single `Clock` service.

`apps/backend/src/common/clock/clock.ts`:

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';

export abstract class Clock {
  abstract nowMs(): number;
  now(): Date {
    return new Date(this.nowMs());
  }
}

@Injectable()
export class SystemClock extends Clock {
  nowMs(): number {
    return Date.now();
  }
}

@Injectable()
export class TestClock extends Clock {
  private offsetMs = 0;
  nowMs(): number {
    return Date.now() + this.offsetMs;
  }
  advance(ms: number): void {
    if (ms < 0) throw new Error('TestClock can only advance forward');
    this.offsetMs += ms;
  }
  reset(): void {
    this.offsetMs = 0;
  }
}
```

The provider is chosen at bootstrap based on `OPENBUCKET_TEST_MODE`:

```ts
// apps/backend/src/common/clock/clock.module.ts
import { Module } from '@nestjs/common';
import { Clock, SystemClock, TestClock } from './clock';

@Module({
  providers: [
    {
      provide: Clock,
      useClass: process.env.OPENBUCKET_TEST_MODE === '1' ? TestClock : SystemClock,
    },
    // Expose TestClock by name only when in test mode so the controller can
    // inject it directly.
    ...(process.env.OPENBUCKET_TEST_MODE === '1' ? [TestClock] : []),
  ],
  exports: [Clock, ...(process.env.OPENBUCKET_TEST_MODE === '1' ? [TestClock] : [])],
})
export class ClockModule {}
```

The hidden admin endpoint, gated by the same env flag:

`apps/backend/src/admin/test/test.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { TestClock } from '../../common/clock/clock';

/**
 * Mounted only when OPENBUCKET_TEST_MODE=1. The module that imports this
 * controller checks the env flag and excludes the controller otherwise —
 * a missing module dependency at production boot would be a 500, which is
 * what we want.
 */
@Controller('api/admin/_test')
export class TestController {
  constructor(@Inject(TestClock) private readonly clock: TestClock) {}

  @Post('advance-clock')
  advance(@Body() body: { ms: number }): { offsetMs: number } {
    if (typeof body?.ms !== 'number' || body.ms < 0) {
      throw new BadRequestException('ms must be a non-negative number');
    }
    this.clock.advance(body.ms);
    return { offsetMs: (this.clock as TestClock & { offsetMs?: number }).nowMs() - Date.now() };
  }
}
```

In `app.module.ts` (owned by the *backend-architect agent*):

```ts
const testControllers = process.env.OPENBUCKET_TEST_MODE === '1' ? [TestController] : [];
```

The lifecycle conformance test then issues `POST /api/admin/_test/advance-clock {"ms": 86400000}` and waits for the next 60s tick — total test time ~60s instead of 24 hours.

---

## 4.12 Shutdown coordination

The shutdown ordering must guarantee:
1. No new requests are accepted.
2. In-flight streams either complete or are forcefully terminated.
3. Background ticks are cancelled and the current tick finishes.
4. The `BlobStore` flushes any open file handles.
5. The MikroORM `EntityManager` and SQLite connection close cleanly (WAL checkpoint).

`apps/backend/src/common/shutdown/shutdown.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { HttpAdapterHost } from '@nestjs/core';
import { Server } from 'node:http';
import { Socket } from 'node:net';
import { BackgroundService } from '../background/background.service';
import { BlobStore } from '../../persistence/blob-store';

const STREAM_DRAIN_DEADLINE_MS = 30_000;

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly log = new Logger(ShutdownService.name);
  private readonly activeSockets = new Set<Socket>();

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(BackgroundService) private readonly background: BackgroundService,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(MikroORM) private readonly orm: MikroORM,
  ) {
    // Track every accepted socket so we can destroy them at the deadline.
    const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
    httpServer?.on('connection', (socket) => {
      this.activeSockets.add(socket);
      socket.once('close', () => this.activeSockets.delete(socket));
    });
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.log.log(`Shutdown initiated (signal=${signal})`);

    // (1) Stop accepting new connections. Existing ones keep working.
    const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
      // server.close() does NOT close keep-alive idle sockets in Node 22 —
      // force them shut so they don't hold the close pending.
      for (const sock of this.activeSockets) {
        if (sock.writable && !sock.writableNeedDrain) {
          sock.end();
        }
      }
    });
    this.log.log('HTTP server stopped accepting new connections');

    // (2) Drain in-flight streams: give them up to 30s, then destroy.
    const drainStart = Date.now();
    while (this.activeSockets.size > 0) {
      if (Date.now() - drainStart >= STREAM_DRAIN_DEADLINE_MS) {
        this.log.warn(
          `Drain deadline reached with ${this.activeSockets.size} sockets — destroying`,
        );
        for (const sock of this.activeSockets) {
          sock.destroy();
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    this.log.log(`Stream drain complete in ${Date.now() - drainStart}ms`);

    // (3) Cancel scheduler ticks and await the in-flight tick.
    //     BackgroundService.onApplicationShutdown handles this; Nest invokes
    //     it via the shutdown-hook chain in registration order, but we want
    //     the explicit ordering, so we call it directly here. Re-entrancy is
    //     safe — the service guards on `shuttingDown`.
    await this.background.onApplicationShutdown();
    this.log.log('Background ticks cancelled and drained');

    // (4) Close BlobStore handles (any open write streams it pooled).
    await this.blobs.close?.();
    this.log.log('BlobStore closed');

    // (5) Close MikroORM (also checkpoints WAL on better-sqlite3).
    await this.orm.close(true);
    this.log.log('MikroORM closed');

    this.log.log('Shutdown complete');
  }
}
```

The ordering is deliberate and load-bearing:

| Step | Why this order |
|---|---|
| Stop accepting | Without this first, drain never terminates because new requests keep arriving. |
| Drain streams (30s) | Lets a multi-GB PUT in flight at SIGTERM finish if it's close; aborts cleanly if not. |
| Cancel ticks | A tick that grabs a row lock just before EM close would error. Cancelling first is cleaner than racing. |
| BlobStore close | The persistence agent may pool open fds for hot writes; flush them before EM close so any final row updates land. |
| EM/SQLite close | Must be last — every prior step might emit a final write. Closing here triggers a WAL checkpoint, leaving the DB file in a clean state for the next boot. |

The backend-architect's bootstrap calls `app.enableShutdownHooks()` which fires `OnApplicationShutdown` on every provider. `ShutdownService` registers explicitly with `BackgroundService` and `BlobStore` so the order is enforced regardless of Nest's internal provider order.
# 5. Admin API, Frontend, Auth Flow & Delivery

This section specifies the JSON admin API that lives at `/api/admin/*`, the Angular SPA that lives at `/admin/*`, the authentication flow that ties them together, and the build pipeline that produces the single Docker image carrying both. The S3 wire protocol (everything else on port 9000) is owned by the S3 agent and only referenced where its boundary touches admin code.

The admin surface is single-tenant: one admin user record, one pair of root S3 access keys, no roles. The endpoints for sub-keys are defined so a future role model drops in without breaking the wire shape [see §2 of `ARCHITECTURE.md`].

---

## 5.1 Admin module tree

`AdminModule` is the root of the `/api/admin/*` controller tree. It imports five feature modules and one global JWT guard. Domain logic is never reimplemented here — every controller is a thin adapter over a domain service from `apps/backend/src/domain/*` [see §1 of `BACKEND-DESIGN.md`].

```
apps/backend/src/admin/
  admin.module.ts
  auth/
    auth.module.ts
    auth.controller.ts
    auth.service.ts
    jwt-auth.guard.ts
    jwt.strategy.ts
    refresh-token.service.ts
    dto/
      login.dto.ts
      login-response.dto.ts
      me-response.dto.ts
  buckets/
    buckets-admin.module.ts
    buckets-admin.controller.ts
    dto/
      create-bucket.dto.ts
      bucket-summary.dto.ts
      list-buckets-response.dto.ts
  objects/
    objects-admin.module.ts
    objects-admin.controller.ts
    dto/
      list-objects-query.dto.ts
      list-objects-response.dto.ts
      object-meta.dto.ts
  keys/
    keys-admin.module.ts
    keys-admin.controller.ts
    dto/
      create-key.dto.ts
      key-summary.dto.ts
      created-key.dto.ts
  settings/
    settings-admin.module.ts
    settings-admin.controller.ts
    dto/
      change-password.dto.ts
      settings.dto.ts
  audit/
    audit.service.ts        // structured admin-event emitter
  bootstrap/
    admin-bootstrap.service.ts   // first-run admin user seeding
```

### 5.1.1 `admin.module.ts`

```ts
// apps/backend/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { BucketsAdminModule } from './buckets/buckets-admin.module';
import { ObjectsAdminModule } from './objects/objects-admin.module';
import { KeysAdminModule } from './keys/keys-admin.module';
import { SettingsAdminModule } from './settings/settings-admin.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AuditService } from './audit/audit.service';
import { AdminBootstrapService } from './bootstrap/admin-bootstrap.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    BucketsAdminModule,
    ObjectsAdminModule,
    KeysAdminModule,
    SettingsAdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    AuditService,
    AdminBootstrapService,
  ],
  exports: [AuditService],
})
export class AdminModule {}
```

The `APP_GUARD` binding makes `JwtAuthGuard` global — every admin route is authenticated unless the controller method is marked `@Public()`. Login and refresh use that decorator.

The throttler default (`100/min` per IP) covers normal traffic; the login endpoint overrides it to `5/min`.

---

## 5.2 Authentication endpoints

The admin auth flow uses two tokens [see §4.1 of `BACKEND-DESIGN.md`]:

1. **Access token** — HS256-signed JWT, 15-minute lifetime, carried in `Authorization: Bearer ...`. Held in Angular memory only.
2. **Refresh token** — opaque 256-bit value, 7-day lifetime, delivered as `Set-Cookie: ob_refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth`. Stored hashed (argon2id) in the `refresh_tokens` table. Rotated on every use.

Token reuse is treated as a compromise signal: if a refresh token that has already been rotated is presented again, the entire chain (every descendant) is revoked.

### 5.2.1 `auth.module.ts`

```ts
// apps/backend/src/admin/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RefreshTokenService } from './refresh-token.service';
import { PersistenceModule } from '../../persistence/persistence.module';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [
    PassportModule,
    PersistenceModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5, name: 'login' }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',
          issuer: 'openbucket',
          audience: 'openbucket-admin',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RefreshTokenService, AuditService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

### 5.2.2 `auth.service.ts`

```ts
// apps/backend/src/admin/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { AdminUserRepository } from '../../persistence/repositories/admin-user.repository';
import { RefreshTokenService } from './refresh-token.service';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;        // seconds
  refreshToken: string;     // raw value; controller sets cookie
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private static readonly ACCESS_TTL_SECONDS = 15 * 60;

  constructor(
    private readonly jwt: JwtService,
    private readonly users: AdminUserRepository,
    private readonly refresh: RefreshTokenService,
  ) {}

  async login(username: string, password: string): Promise<IssuedTokens> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      // Constant-time dummy verify to avoid user-enumeration timing.
      await argon2.verify(
        '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        password,
      ).catch(() => false);
      throw new UnauthorizedException('invalid credentials');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    return this.issueTokens(user.id, user.username, user.mustChangePassword);
  }

  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    const rotated = await this.refresh.rotate(rawRefreshToken);
    return this.issueTokens(rotated.subjectId, rotated.username, false, rotated.token, rotated.expiresAt);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) await this.refresh.revoke(rawRefreshToken);
  }

  private async issueTokens(
    subjectId: string,
    username: string,
    mustChangePassword: boolean,
    preIssuedRefreshRaw?: string,
    preIssuedRefreshExpiresAt?: Date,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({
      sub: subjectId,
      username,
      mustChangePassword,
    });

    if (preIssuedRefreshRaw && preIssuedRefreshExpiresAt) {
      return {
        accessToken,
        expiresIn: AuthService.ACCESS_TTL_SECONDS,
        refreshToken: preIssuedRefreshRaw,
        refreshExpiresAt: preIssuedRefreshExpiresAt,
      };
    }

    const minted = await this.refresh.mint(subjectId, username);
    return {
      accessToken,
      expiresIn: AuthService.ACCESS_TTL_SECONDS,
      refreshToken: minted.token,
      refreshExpiresAt: minted.expiresAt,
    };
  }
}
```

### 5.2.3 `refresh-token.service.ts`

```ts
// apps/backend/src/admin/auth/refresh-token.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

import { RefreshTokenRepository } from '../../persistence/repositories/refresh-token.repository';

export interface MintedRefresh {
  token: string;        // raw, base64url
  expiresAt: Date;
}

export interface RotatedRefresh extends MintedRefresh {
  subjectId: string;
  username: string;
}

@Injectable()
export class RefreshTokenService {
  private static readonly TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(private readonly repo: RefreshTokenRepository) {}

  async mint(subjectId: string, username: string, rotatedFromId?: string): Promise<MintedRefresh> {
    const raw = randomBytes(32).toString('base64url');
    const lookup = createHash('sha256').update(raw).digest('hex'); // indexed
    const hash = await argon2.hash(raw, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + RefreshTokenService.TTL_MS);

    await this.repo.insert({
      lookup,
      hash,
      subjectId,
      username,
      issuedAt: new Date(),
      expiresAt,
      rotatedFromId: rotatedFromId ?? null,
      revokedAt: null,
      rotatedAt: null,
    });

    return { token: raw, expiresAt };
  }

  async rotate(rawToken: string): Promise<RotatedRefresh> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row) throw new UnauthorizedException('invalid refresh');

    if (row.revokedAt) throw new UnauthorizedException('revoked');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('expired');

    if (row.rotatedAt) {
      // Reuse of an already-rotated token — treat as compromise.
      await this.repo.revokeDescendants(row.id);
      throw new UnauthorizedException('token reuse detected');
    }

    const ok = await argon2.verify(row.hash, rawToken);
    if (!ok) throw new UnauthorizedException('invalid refresh');

    await this.repo.markRotated(row.id, new Date());
    const minted = await this.mint(row.subjectId, row.username, row.id);
    return { ...minted, subjectId: row.subjectId, username: row.username };
  }

  async revoke(rawToken: string): Promise<void> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row || row.revokedAt) return;
    await this.repo.revoke(row.id, new Date());
  }
}
```

The `lookup` column is a fast SHA-256 used solely to find the row; the argon2id `hash` is the actual cryptographic gate. Without the indexed lookup we would argon2-verify against every row in the table.

### 5.2.4 `auth.controller.ts`

```ts
// apps/backend/src/admin/auth/auth.controller.ts
import {
  Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { AuditService } from '../audit/audit.service';

const REFRESH_COOKIE = 'ob_refresh';

@Controller('api/admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const tokens = await this.auth.login(dto.username, dto.password);
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    this.audit.emit({ event: 'admin.login', subject: dto.username, ip: req.ip });
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException('missing refresh');
    const tokens = await this.auth.refresh(raw);
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/admin/auth' });
    this.audit.emit({ event: 'admin.logout', subject: (req as any).user?.username ?? 'unknown' });
  }

  @Get('me')
  me(@Req() req: Request): MeResponseDto {
    const user = (req as any).user as { sub: string; username: string; mustChangePassword: boolean };
    return {
      id: user.sub,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private setRefreshCookie(res: Response, value: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/admin/auth',
      expires: expiresAt,
    });
  }
}
```

`@Public()` is a tiny metadata-only decorator:

```ts
// apps/backend/src/admin/auth/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
```

---

## 5.3 `JwtAuthGuard`

The guard sits on `APP_GUARD`. It skips any handler annotated `@Public()`, validates the bearer token, and attaches the decoded payload to `req.user`.

```ts
// apps/backend/src/admin/auth/jwt-auth.guard.ts
import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from './public.decorator';

export interface AdminJwtPayload {
  sub: string;
  username: string;
  mustChangePassword: boolean;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // Only protect /api/admin/* — let S3 and SPA pass.
    if (!req.path.startsWith('/api/admin/')) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer');

    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        issuer: 'openbucket',
        audience: 'openbucket-admin',
      });
      (req as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }
}
```

The path-prefix guard at the top is the safety net: the `AdminModule` is mounted globally, but the S3 and SPA controller trees must never see a `401` from this guard. If they ever share a controller path, the JWT guard is invisible to them.

---

## 5.4 `nestjs-zod` DTO patterns

DTOs are Zod schemas first, classes second. The class is what NestJS uses for DI and Swagger; the schema is what the global `ZodValidationPipe` runs against the request body, query, and params. The backend-architect agent wires the global pipe and applies `patchNestjsSwagger()` in `main.ts`; this section shows what controllers consume.

The general pattern:

```ts
// somewhere/dto/example.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const ExampleSchema = z.object({
  name: z.string().min(3).max(63),
  count: z.number().int().nonnegative().default(0),
});

export class ExampleDto extends createZodDto(ExampleSchema) {}
```

`createZodDto` produces a class whose static `schema` is the Zod object. `patchNestjsSwagger()` (called once in `main.ts`) walks every controller and emits the schema into the OpenAPI document.

### 5.4.1 `CreateBucketDto`

```ts
// apps/backend/src/admin/buckets/dto/create-bucket.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export const CreateBucketSchema = z
  .object({
    name: z
      .string()
      .min(3)
      .max(63)
      .regex(BUCKET_NAME, 'bucket name must match S3 naming rules'),
    versioning: z.enum(['disabled', 'enabled']).default('disabled'),
    objectLock: z.boolean().default(false),
    region: z.string().default('us-east-1'),
  })
  .strict();

export class CreateBucketDto extends createZodDto(CreateBucketSchema) {}
```

`.strict()` rejects unknown keys — a quiet but important defense against typo'd request bodies silently succeeding.

### 5.4.2 `BucketSummaryDto` / `ListBucketsResponseDto`

```ts
// apps/backend/src/admin/buckets/dto/bucket-summary.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const BucketSummarySchema = z.object({
  name: z.string(),
  createdAt: z.string().datetime(),
  versioning: z.enum(['disabled', 'enabled', 'suspended']),
  objectLock: z.boolean(),
  objectCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

export class BucketSummaryDto extends createZodDto(BucketSummarySchema) {}
```

```ts
// apps/backend/src/admin/buckets/dto/list-buckets-response.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

import { BucketSummarySchema } from './bucket-summary.dto';

export const ListBucketsResponseSchema = z.object({
  buckets: z.array(BucketSummarySchema),
  total: z.number().int().nonnegative(),
});

export class ListBucketsResponseDto extends createZodDto(ListBucketsResponseSchema) {}
```

Both response and request DTOs flow into the OpenAPI document, which the generator turns into Angular models — no hand-written interfaces on the frontend.

### 5.4.3 `ListObjectsQueryDto`

```ts
// apps/backend/src/admin/objects/dto/list-objects-query.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const ListObjectsQuerySchema = z.object({
  prefix: z.string().max(1024).optional(),
  delimiter: z.string().max(1).optional(),         // typically '/'
  marker: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export class ListObjectsQueryDto extends createZodDto(ListObjectsQuerySchema) {}
```

`z.coerce.number()` is essential for query strings — Express delivers everything as a string.

---

## 5.5 Admin bucket endpoints

```ts
// apps/backend/src/admin/buckets/buckets-admin.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { BucketService } from '../../domain/buckets/bucket.service';
import { ObjectService } from '../../domain/objects/object.service';
import { CreateBucketDto } from './dto/create-bucket.dto';
import { BucketSummaryDto } from './dto/bucket-summary.dto';
import { ListBucketsResponseDto } from './dto/list-buckets-response.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/buckets')
export class BucketsAdminController {
  constructor(
    private readonly buckets: BucketService,
    private readonly objects: ObjectService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(): Promise<ListBucketsResponseDto> {
    const items = await this.buckets.listWithStats();
    return {
      buckets: items.map((b) => ({
        name: b.name,
        createdAt: b.createdAt.toISOString(),
        versioning: b.versioning,
        objectLock: b.objectLock,
        objectCount: b.stats.objectCount,
        sizeBytes: b.stats.sizeBytes,
      })),
      total: items.length,
    };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateBucketDto,
    @Req() req: Request,
  ): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.create({
      name: dto.name,
      versioning: dto.versioning,
      objectLock: dto.objectLock,
      region: dto.region,
    });
    this.audit.emit({
      event: 'bucket.created',
      subject: (req as any).user.username,
      bucket: bucket.name,
      requestId: (req as any).requestId,
    });
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock,
      objectCount: 0,
      sizeBytes: 0,
    };
  }

  @Get(':name')
  async get(@Param('name') name: string): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.findByName(name);
    if (!bucket) throw new NotFoundException(`bucket ${name} not found`);
    const stats = await this.objects.statsFor(name);
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock,
      objectCount: stats.objectCount,
      sizeBytes: stats.sizeBytes,
    };
  }

  @Delete(':name')
  @HttpCode(204)
  async delete(
    @Param('name') name: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.deleteByName(name);   // throws BucketNotEmpty if non-empty
    this.audit.emit({
      event: 'bucket.deleted',
      subject: (req as any).user.username,
      bucket: name,
      requestId: (req as any).requestId,
    });
  }
}
```

`BucketService` and `ObjectService` are the same domain services the S3 controllers call. The admin controller is a thin shape adapter — no business rules live here.

---

## 5.6 Admin object browser endpoints

```ts
// apps/backend/src/admin/objects/objects-admin.controller.ts
import {
  Controller, Delete, Get, HttpCode, NotFoundException, Param, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { ObjectService } from '../../domain/objects/object.service';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ListObjectsResponseDto } from './dto/list-objects-response.dto';
import { ObjectMetaDto } from './dto/object-meta.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/buckets/:name/objects')
export class ObjectsAdminController {
  constructor(
    private readonly objects: ObjectService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Param('name') bucket: string,
    @Query() q: ListObjectsQueryDto,
  ): Promise<ListObjectsResponseDto> {
    const page = await this.objects.list({
      bucket,
      prefix: q.prefix,
      delimiter: q.delimiter,
      marker: q.marker,
      limit: q.limit,
    });
    return {
      bucket,
      prefix: q.prefix ?? '',
      delimiter: q.delimiter,
      marker: q.marker,
      nextMarker: page.nextMarker,
      isTruncated: page.isTruncated,
      contents: page.contents.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        lastModified: o.lastModified.toISOString(),
        storageClass: o.storageClass,
      })),
      commonPrefixes: page.commonPrefixes,
    };
  }

  @Get(':key(*)/meta')
  async meta(
    @Param('name') bucket: string,
    @Param('key') key: string,
  ): Promise<ObjectMetaDto> {
    const obj = await this.objects.head(bucket, decodeURIComponent(key));
    if (!obj) throw new NotFoundException();
    return {
      key: obj.key,
      bucket,
      size: obj.size,
      etag: obj.etag,
      contentType: obj.contentType,
      contentEncoding: obj.contentEncoding,
      lastModified: obj.lastModified.toISOString(),
      userMetadata: obj.userMetadata,
      tagging: obj.tagging,
      versionId: obj.versionId,
      storageClass: obj.storageClass,
    };
  }

  @Delete(':key(*)')
  @HttpCode(204)
  async delete(
    @Param('name') bucket: string,
    @Param('key') key: string,
    @Req() req: Request,
  ): Promise<void> {
    const decoded = decodeURIComponent(key);
    await this.objects.delete(bucket, decoded);
    this.audit.emit({
      event: 'object.deleted',
      subject: (req as any).user.username,
      bucket,
      key: decoded,
      requestId: (req as any).requestId,
    });
  }
}
```

The `:key(*)` route param captures slash-bearing object keys (`folder/sub/file.txt`). The client URL-encodes the key before sending; the controller `decodeURIComponent`s it once. Double-decode bugs are avoided by encoding exactly once on the client side (see §5.13).

---

## 5.7 Access-key management

```ts
// apps/backend/src/admin/keys/keys-admin.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { KeyService } from '../../domain/keys/key.service';
import { CreateKeyDto } from './dto/create-key.dto';
import { CreatedKeyDto } from './dto/created-key.dto';
import { KeySummaryDto } from './dto/key-summary.dto';
import { UpdateKeyDto } from './dto/update-key.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/keys')
export class KeysAdminController {
  constructor(
    private readonly keys: KeyService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(): Promise<KeySummaryDto[]> {
    const rows = await this.keys.list();
    return rows.map((k) => ({
      id: k.id,
      accessKeyId: k.accessKeyId,
      label: k.label,
      role: k.role,                   // 'root' for v1
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      disabled: k.disabled,
    }));
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateKeyDto,
    @Req() req: Request,
  ): Promise<CreatedKeyDto> {
    const created = await this.keys.create({ label: dto.label, role: 'root' });
    this.audit.emit({
      event: 'key.created',
      subject: (req as any).user.username,
      keyId: created.id,
      requestId: (req as any).requestId,
    });
    // SECURITY: secretAccessKey is returned ONCE. Never persisted in plaintext;
    // never returned again on any other endpoint.
    return {
      id: created.id,
      accessKeyId: created.accessKeyId,
      secretAccessKey: created.secretAccessKey,
      label: created.label,
      role: created.role,
      createdAt: created.createdAt.toISOString(),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKeyDto,
    @Req() req: Request,
  ): Promise<KeySummaryDto> {
    const updated = await this.keys.update(id, { disabled: dto.disabled, label: dto.label });
    if (!updated) throw new NotFoundException();
    this.audit.emit({
      event: dto.disabled === true ? 'key.disabled' : 'key.updated',
      subject: (req as any).user.username,
      keyId: id,
      requestId: (req as any).requestId,
    });
    return {
      id: updated.id,
      accessKeyId: updated.accessKeyId,
      label: updated.label,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      disabled: updated.disabled,
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.keys.delete(id);
    this.audit.emit({
      event: 'key.deleted',
      subject: (req as any).user.username,
      keyId: id,
      requestId: (req as any).requestId,
    });
  }
}
```

The `role` field is hard-coded to `'root'` on creation in v1 and exposed in responses so the frontend already renders the column. When sub-keys ship, the schema gains `role: z.enum(['root', 'app'])` and `policy: z.string().optional()`, and no controller path moves.

`CreateKeyDto` and `UpdateKeyDto` are trivial:

```ts
// apps/backend/src/admin/keys/dto/create-key.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const CreateKeySchema = z.object({
  label: z.string().min(1).max(128),
}).strict();

export class CreateKeyDto extends createZodDto(CreateKeySchema) {}
```

```ts
// apps/backend/src/admin/keys/dto/update-key.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const UpdateKeySchema = z.object({
  label: z.string().min(1).max(128).optional(),
  disabled: z.boolean().optional(),
}).strict().refine((v) => v.label !== undefined || v.disabled !== undefined, {
  message: 'at least one field required',
});

export class UpdateKeyDto extends createZodDto(UpdateKeySchema) {}
```

---

## 5.8 Initial admin bootstrap

`AdminBootstrapService` runs in `OnApplicationBootstrap`. Three branches:

1. **`ADMIN_PASSWORD_HASH` env is set** — write/update the admin user row with that hash directly and `mustChangePassword = false`. Lets ops control credentials via the orchestrator.
2. **No admin user row, no env override** — generate a random 24-char temporary password, hash it with argon2id, persist with `mustChangePassword = true`, and log the plaintext to stdout exactly once. The line is intentionally easy to grep (`docker logs openbucket | grep TEMP-ADMIN-PASSWORD`).
3. **Admin user row exists, no env override** — do nothing.

```ts
// apps/backend/src/admin/bootstrap/admin-bootstrap.service.ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

import { AdminUserRepository } from '../../persistence/repositories/admin-user.repository';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly users: AdminUserRepository,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const envHash = this.config.get<string>('ADMIN_PASSWORD_HASH');

    if (envHash) {
      await this.users.upsert({
        username: 'admin',
        passwordHash: envHash,
        mustChangePassword: false,
      });
      this.logger.log('Admin user provisioned from ADMIN_PASSWORD_HASH env.');
      return;
    }

    const existing = await this.users.findByUsername('admin');
    if (existing) return;

    const tempPassword = this.generateTempPassword();
    const hash = await argon2.hash(tempPassword, { type: argon2.argon2id });

    await this.users.insert({
      username: 'admin',
      passwordHash: hash,
      mustChangePassword: true,
    });

    // Visible in `docker logs`. Logged once, at startup, when no user exists.
    // The pino logger is configured to NOT redact this single field.
    this.logger.warn(
      `TEMP-ADMIN-PASSWORD username=admin password=${tempPassword} ` +
      `change-on-first-login=true`,
    );
  }

  private generateTempPassword(): string {
    return randomBytes(18).toString('base64url'); // 24 chars
  }
}
```

The change-on-first-login flow lives in `SettingsAdminController`:

```ts
// apps/backend/src/admin/settings/settings-admin.controller.ts
import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import * as argon2 from 'argon2';

import { AdminUserRepository } from '../../persistence/repositories/admin-user.repository';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/settings')
export class SettingsAdminController {
  constructor(
    private readonly users: AdminUserRepository,
    private readonly audit: AuditService,
  ) {}

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    const subject = (req as any).user as { sub: string; username: string };
    const user = await this.users.findById(subject.sub);
    if (!user) throw new UnauthorizedException();

    const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!ok) throw new UnauthorizedException('current password incorrect');

    const newHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.users.update(user.id, { passwordHash: newHash, mustChangePassword: false });

    this.audit.emit({
      event: 'admin.password.changed',
      subject: user.username,
      requestId: (req as any).requestId,
    });
  }
}
```

The JWT `mustChangePassword` claim drives the SPA to a forced-rotation screen on login. The bearer token is still valid for normal `/api/admin/*` calls; the SPA enforces the redirect on the client side. Defense-in-depth at the API level is deferred to v2 (mustChangePassword is currently advisory, since the only data the user could mutate before rotating is their own password).

---

## 5.9 Audit logging

Every state-changing admin call emits a structured event via Pino. `AuditService` is a thin wrapper that guarantees the standard fields (timestamp, `requestId`, `subject`) are populated.

```ts
// apps/backend/src/admin/audit/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';

export interface AuditEvent {
  event: string;
  subject: string;
  requestId?: string;
  [k: string]: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('admin.audit');

  emit(event: AuditEvent): void {
    // nestjs-pino flattens the second argument into the JSON record.
    this.logger.log({ ...event, audit: true });
  }
}
```

### Canonical event catalogue (v1)

| Event | Emitted when | Required fields |
|---|---|---|
| `admin.login` | successful login | `subject`, `ip` |
| `admin.login.failed` | failed login attempt | `username`, `ip` (no `subject` if unknown) |
| `admin.logout` | logout call | `subject` |
| `admin.password.changed` | password rotated | `subject` |
| `bucket.created` | new bucket | `subject`, `bucket` |
| `bucket.deleted` | bucket dropped | `subject`, `bucket` |
| `bucket.versioning.changed` | versioning toggled | `subject`, `bucket`, `from`, `to` |
| `object.deleted` | object purge via admin | `subject`, `bucket`, `key` |
| `key.created` | access key minted | `subject`, `keyId` |
| `key.disabled` | access key disabled | `subject`, `keyId` |
| `key.updated` | access key edited | `subject`, `keyId` |
| `key.deleted` | access key removed | `subject`, `keyId` |
| `settings.changed` | settings update | `subject`, `field` |

Read-only calls (`GET`) are not audited at v1 — they would dwarf the event stream. The `requestId` field is set by the backend-architect agent's request-id middleware.

---

## 5.10 Angular SPA structure

```
apps/frontend/src/app/
  app.config.ts
  app.routes.ts
  app.component.ts
  auth/
    login.component.ts
    force-rotate.component.ts
    auth.service.ts
    auth.guard.ts
    auth.interceptor.ts
  buckets/
    bucket-list.component.ts
    bucket-detail.component.ts
    bucket-create-dialog.component.ts
    buckets.signal-store.ts
  objects/
    object-browser.component.ts
    object-row.component.ts
    object-breadcrumb.component.ts
    object-upload.component.ts
    objects.signal-store.ts
  keys/
    keys-list.component.ts
    key-create-dialog.component.ts
    key-secret-once-dialog.component.ts
    keys.signal-store.ts
  settings/
    settings.component.ts
    change-password.component.ts
  shared/
    layout/shell.component.ts
    layout/topbar.component.ts
    layout/sidenav.component.ts
    ui/byte-size.pipe.ts
    ui/relative-time.pipe.ts
    ui/confirm-dialog.component.ts
    api/api-client.providers.ts
  app.routes.ts
  main.ts
```

Every component is standalone (Angular 18+). The app uses signals for local state and a small signal-store pattern (see §5.15) for cross-component state.

Standalone bootstrap:

```ts
// apps/frontend/src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
```

```ts
// apps/frontend/src/app/app.config.ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors, withFetch } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';
import { provideApiClient } from './shared/api/api-client.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideApiClient(),
  ],
};
```

---

## 5.11 Routing

```ts
// apps/frontend/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard, unauthGuard, mustNotRotateGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'buckets' },

  {
    path: 'login',
    canActivate: [unauthGuard],
    loadComponent: () =>
      import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'force-rotate',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./auth/force-rotate.component').then((m) => m.ForceRotateComponent),
  },

  {
    path: '',
    canActivate: [authGuard, mustNotRotateGuard],
    loadComponent: () =>
      import('./shared/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'buckets',
        loadComponent: () =>
          import('./buckets/bucket-list.component').then((m) => m.BucketListComponent),
      },
      {
        path: 'buckets/:name',
        loadComponent: () =>
          import('./buckets/bucket-detail.component').then((m) => m.BucketDetailComponent),
      },
      {
        path: 'buckets/:name/browse',
        loadComponent: () =>
          import('./objects/object-browser.component').then((m) => m.ObjectBrowserComponent),
      },
      {
        path: 'keys',
        loadComponent: () =>
          import('./keys/keys-list.component').then((m) => m.KeysListComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },

  { path: '**', redirectTo: 'buckets' },
];
```

```ts
// apps/frontend/src/app/auth/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login']);
};

export const unauthGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? router.createUrlTree(['/buckets']) : true;
};

export const mustNotRotateGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.mustChangePassword() ? router.createUrlTree(['/force-rotate']) : true;
};
```

The router is mounted under `/admin` by the backend's static-serve module [see §8.3 of `BACKEND-DESIGN.md`]; Angular's `base href` is set to `/admin/` at build time:

```jsonc
// apps/frontend/project.json (excerpt)
"build": {
  "executor": "@angular-devkit/build-angular:application",
  "options": {
    "baseHref": "/admin/",
    "outputPath": "dist/apps/frontend"
  }
}
```

---

## 5.12 Auth state — `AuthService` and HTTP interceptor

The access token never touches `localStorage`. It lives in a private signal in `AuthService` for the lifetime of the page. On a hard reload, the SPA calls `/api/admin/auth/refresh` first thing; the browser sends the HttpOnly cookie, the backend returns a fresh access token, and the SPA proceeds. If refresh fails, the user lands on `/login`.

```ts
// apps/frontend/src/app/auth/auth.service.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
}

interface MeResponse {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly accessToken = signal<string | null>(null);
  private readonly me = signal<MeResponse | null>(null);

  readonly isAuthenticated = computed(() => this.accessToken() !== null);
  readonly mustChangePassword = computed(() => this.me()?.mustChangePassword === true);
  readonly username = computed(() => this.me()?.username ?? null);

  getAccessToken(): string | null {
    return this.accessToken();
  }

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/admin/auth/login', { username, password }, {
        withCredentials: true,
      }),
    );
    this.accessToken.set(res.accessToken);
    await this.loadMe();
    await this.router.navigate([this.mustChangePassword() ? '/force-rotate' : '/buckets']);
  }

  /**
   * Calls the refresh endpoint exactly once. Used both at app start and by the
   * HTTP interceptor on 401. The HttpOnly cookie carries the refresh token.
   */
  async refresh(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<LoginResponse>('/api/admin/auth/refresh', {}, {
          withCredentials: true,
        }),
      );
      this.accessToken.set(res.accessToken);
      if (!this.me()) await this.loadMe();
      return true;
    } catch {
      this.accessToken.set(null);
      this.me.set(null);
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/admin/auth/logout', {}, { withCredentials: true }),
      );
    } finally {
      this.accessToken.set(null);
      this.me.set(null);
      await this.router.navigate(['/login']);
    }
  }

  private async loadMe(): Promise<void> {
    const me = await firstValueFrom(this.http.get<MeResponse>('/api/admin/auth/me'));
    this.me.set(me);
  }
}
```

The interceptor injects the bearer header on every request and retries exactly once on a 401, calling `refresh()` in between. A second 401 forces logout — the refresh either failed or the access token was rejected for a reason refresh cannot fix.

```ts
// apps/frontend/src/app/auth/auth.interceptor.ts
import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const AUTH_PATHS = ['/api/admin/auth/login', '/api/admin/auth/refresh'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  // Don't attach a bearer to the login/refresh calls themselves.
  if (AUTH_PATHS.some((p) => req.url.startsWith(p))) {
    return next(req.clone({ withCredentials: true }));
  }

  const withAuth = attachToken(req, auth.getAccessToken());

  return next(withAuth).pipe(
    catchError((err) => {
      if (err?.status !== 401) return throwError(() => err);

      // Attempt a single refresh, then retry the original request.
      return from(auth.refresh()).pipe(
        switchMap((ok): Observable<HttpEvent<unknown>> => {
          if (!ok) {
            auth.logout(); // fire-and-forget; will route to /login
            return throwError(() => err);
          }
          return next(attachToken(req, auth.getAccessToken()));
        }),
      );
    }),
  );
};

function attachToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  if (!token) return req;
  return req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
    withCredentials: true,
  });
}
```

A subtle but important detail: the interceptor passes `withCredentials: true` on every request so the browser sends the refresh cookie when the API path falls inside `/api/admin/auth/*`. Since the cookie is scoped to that path, other admin endpoints will not receive it, and there is no CSRF surface for state-changing endpoints — those rely solely on the bearer token, which lives in JS memory.

---

## 5.13 API client integration

The generated client lives in `libs/api-client` and is published as `@openbucket/api-client` in the Nx workspace (TypeScript paths only — never NPM). The Angular app imports the generated services directly.

```ts
// apps/frontend/src/app/shared/api/api-client.providers.ts
import { Provider, EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  ApiModule,
  Configuration,
  ConfigurationParameters,
  BucketsService,
  ObjectsService,
  KeysService,
} from '@openbucket/api-client';

export function provideApiClient(): EnvironmentProviders {
  const params: ConfigurationParameters = {
    basePath: '', // same origin — admin SPA is served by the same backend
  };
  return makeEnvironmentProviders([
    { provide: Configuration, useValue: new Configuration(params) },
    BucketsService,
    ObjectsService,
    KeysService,
  ]);
}
```

The interceptor handles auth header injection, so the generated services need zero customization. Consuming the generated `BucketsService` in a component:

```ts
// apps/frontend/src/app/buckets/bucket-list.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BucketsService, BucketSummaryDto } from '@openbucket/api-client';
import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';

@Component({
  standalone: true,
  selector: 'ob-bucket-list',
  imports: [CommonModule, RouterLink, ByteSizePipe, RelativeTimePipe],
  template: `
    <div class="toolbar">
      <h1>Buckets</h1>
      <button (click)="openCreate()">Create bucket</button>
    </div>

    @if (loading()) {
      <p>Loading…</p>
    } @else {
      <table>
        <thead>
          <tr><th>Name</th><th>Objects</th><th>Size</th><th>Created</th></tr>
        </thead>
        <tbody>
          @for (b of buckets(); track b.name) {
            <tr>
              <td><a [routerLink]="['/buckets', b.name, 'browse']">{{ b.name }}</a></td>
              <td>{{ b.objectCount }}</td>
              <td>{{ b.sizeBytes | byteSize }}</td>
              <td>{{ b.createdAt | relativeTime }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export class BucketListComponent implements OnInit {
  private readonly api = inject(BucketsService);

  readonly buckets = signal<BucketSummaryDto[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      const res = await this.api.bucketsAdminControllerList().toPromise();
      this.buckets.set(res?.buckets ?? []);
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void { /* opens BucketCreateDialogComponent */ }
}
```

The method name `bucketsAdminControllerList` is produced by openapi-generator from the controller class + method. To keep names tolerable, use `@nestjs/swagger`'s `@ApiOperation({ operationId: 'listBuckets' })` on each handler — the generator picks up `operationId` and produces `bucketsService.listBuckets()` instead.

---

## 5.14 Object browser UI

The bucket detail page hosts an `ObjectBrowserComponent` that paginates with `prefix` + `delimiter='/'` to give the "folder" experience S3 users expect.

Component tree:

```
ObjectBrowserComponent (route /buckets/:name/browse)
  ObjectBreadcrumbComponent          // prefix path: bucket > a > b > c
  ObjectUploadComponent              // drag-and-drop + button
  table
    ObjectRowComponent (one per common prefix or object)
      - folder rows → click sets prefix to <currentPrefix><name>/
      - object rows → click opens metadata side-panel; download via signed URL or admin endpoint
```

Pagination model: `marker` from the API drives the next page. The browser keeps a stack of `(prefix, marker)` tuples so the back button works without hitting the server.

For uploads, **v1 uses the admin endpoint, not presigned URLs** — the SPA is same-origin and already authenticated, so the simpler route is to `PUT /api/admin/buckets/:name/objects/:key(*)` with a streaming body, which the backend forwards into the same domain `ObjectService` the S3 controller calls. (The admin upload endpoint is added under §5.6's controller as `@Put(':key(*)')` and is non-XML; spec details belong to the streaming agent.)

```ts
// apps/frontend/src/app/objects/object-upload.component.ts
import { Component, EventEmitter, Input, Output, signal, inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: true,
  selector: 'ob-object-upload',
  template: `
    <div class="dropzone"
         (dragover)="onDragOver($event)"
         (drop)="onDrop($event)">
      <input type="file" multiple (change)="onPick($event)" />
      <span>Drop files here, or click to select.</span>
    </div>

    @for (u of uploads(); track u.id) {
      <div class="row">
        <span>{{ u.name }}</span>
        <progress [value]="u.progress" max="100"></progress>
        @if (u.error) { <span class="error">{{ u.error }}</span> }
      </div>
    }
  `,
})
export class ObjectUploadComponent {
  private readonly http = inject(HttpClient);

  @Input({ required: true }) bucket!: string;
  @Input({ required: true }) prefix = '';
  @Output() uploaded = new EventEmitter<string>();   // emits key

  readonly uploads = signal<UploadState[]>([]);

  onDragOver(e: DragEvent): void { e.preventDefault(); }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files) this.startMany(files);
  }
  onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files) this.startMany(input.files);
  }

  private startMany(list: FileList): void {
    for (const f of Array.from(list)) void this.startOne(f);
  }

  private async startOne(file: File): Promise<void> {
    const id = crypto.randomUUID();
    const key = this.prefix + file.name;
    const encoded = encodeURIComponent(key);
    this.uploads.update((arr) => [...arr, { id, name: key, progress: 0 }]);
    const url = `/api/admin/buckets/${this.bucket}/objects/${encoded}`;
    try {
      await firstValueFrom(
        this.http.put(url, file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          reportProgress: true,
          observe: 'events',
        }).pipe(
          // see RxJS tap operator in real code; collapsed here for brevity
        ),
      );
      this.uploaded.emit(key);
      this.patch(id, { progress: 100 });
    } catch (err: unknown) {
      this.patch(id, { error: (err as Error).message });
    }
  }

  private patch(id: string, fields: Partial<UploadState>): void {
    this.uploads.update((arr) => arr.map((u) => (u.id === id ? { ...u, ...fields } : u)));
  }
}

interface UploadState {
  id: string;
  name: string;
  progress: number;
  error?: string;
}
```

The encoded-once rule (`encodeURIComponent` on the client, `decodeURIComponent` once on the server) is the single rule that keeps slash-bearing keys from being treated as path segments.

---

## 5.15 State management — signals

No NgRx in v1. Each feature exposes a tiny "signal store" — a service holding signals plus mutation methods. Components read via the signals; mutations call API and update the signals on success.

```ts
// apps/frontend/src/app/buckets/buckets.signal-store.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { BucketsService, BucketSummaryDto, CreateBucketDto } from '@openbucket/api-client';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BucketsSignalStore {
  private readonly api = inject(BucketsService);

  private readonly _items = signal<BucketSummaryDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly count = computed(() => this._items().length);

  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const res = await firstValueFrom(this.api.listBuckets());
      this._items.set(res?.buckets ?? []);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  async create(dto: CreateBucketDto): Promise<void> {
    const created = await firstValueFrom(this.api.createBucket(dto));
    if (created) this._items.update((arr) => [...arr, created]);
  }

  async remove(name: string): Promise<void> {
    await firstValueFrom(this.api.deleteBucket(name));
    this._items.update((arr) => arr.filter((b) => b.name !== name));
  }
}
```

This pattern scales until app-wide state shape becomes non-trivial — if that day arrives, NgRx SignalStore is a small migration; the public read surface (`items`, `loading`, `error`) stays the same.

---

## 5.16 OpenAPI generation pipeline

The pipeline has three Nx targets and a CI check:

1. **`backend:openapi:export`** — boots the Nest app in spec-only mode and writes `apps/backend/dist/openapi.json`.
2. **`api-client:generate`** — runs `openapi-generator-cli` against that file, output into `libs/api-client/src/lib`.
3. **`api-client:check`** — re-runs `generate` and checks for git diff; fails in CI if the committed lib is stale.

### 5.16.1 Spec export script

```ts
// apps/backend/src/openapi-export.ts
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { patchNestjsSwagger } from 'nestjs-zod';

import { AppModule } from './app.module';

async function exportSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  patchNestjsSwagger();

  const config = new DocumentBuilder()
    .setTitle('OpenBucket Admin API')
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addServer('/')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    operationIdFactory: (controllerKey, methodKey) => methodKey,
  });

  const out = resolve(__dirname, '../dist/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(document, null, 2));
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI spec written to ${out}`);
}

void exportSpec();
```

`operationIdFactory: (controllerKey, methodKey) => methodKey` keeps generated method names short (`listBuckets`, not `BucketsAdminController_list`).

### 5.16.2 Backend project target

```jsonc
// apps/backend/project.json (relevant excerpt)
{
  "targets": {
    "openapi:export": {
      "executor": "nx:run-commands",
      "options": {
        "commands": [
          "tsx apps/backend/src/openapi-export.ts"
        ],
        "parallel": false
      },
      "outputs": ["{workspaceRoot}/apps/backend/dist/openapi.json"]
    }
  }
}
```

### 5.16.3 API-client project targets

```jsonc
// libs/api-client/project.json
{
  "name": "api-client",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "sourceRoot": "libs/api-client/src",
  "targets": {
    "generate": {
      "executor": "nx:run-commands",
      "dependsOn": [{ "projects": ["backend"], "target": "openapi:export" }],
      "options": {
        "commands": [
          "rimraf libs/api-client/src/lib",
          "openapi-generator-cli generate -i apps/backend/dist/openapi.json -g typescript-angular -o libs/api-client/src/lib --additional-properties=ngVersion=18.0.0,providedIn=root,withInterfaces=true,fileNaming=kebab-case,stringEnums=true,supportsES6=true"
        ],
        "parallel": false
      },
      "outputs": ["{workspaceRoot}/libs/api-client/src/lib"]
    },
    "check": {
      "executor": "nx:run-commands",
      "dependsOn": ["generate"],
      "options": {
        "commands": [
          "git diff --exit-code -- libs/api-client/src/lib || (echo 'api-client is stale — run: nx run api-client:generate && commit' && exit 1)"
        ]
      }
    },
    "build": {
      "executor": "@nx/angular:package",
      "options": {
        "project": "libs/api-client/ng-package.json"
      },
      "dependsOn": ["generate"]
    }
  },
  "tags": ["scope:shared", "type:client"]
}
```

The `check` target is wired into CI (`nx run api-client:check`). It re-generates, then asks git whether anything changed; if so, the PR is told to run `nx run api-client:generate` locally and commit.

### 5.16.4 Library barrel

```ts
// libs/api-client/src/index.ts
export * from './lib/api/api';
export * from './lib/model/models';
export * from './lib/configuration';
```

A tsconfig path alias (`@openbucket/api-client`) points to `libs/api-client/src/index.ts`; consumers import from the package name only.

---

## 5.17 Docker multi-stage build

```dockerfile
# Dockerfile
# syntax=docker/dockerfile:1.7

# ---------- stage 1 : build ----------
FROM node:22-bookworm-slim AS build
# bookworm-slim (glibc) — alpine (musl) breaks better-sqlite3 prebuilt bindings.
# Rebuilding from source on alpine works but adds ~30s and a python toolchain.

WORKDIR /workspace

# System deps for native modules (better-sqlite3 prebuild headers, argon2).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies with a deterministic lock.
COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps ./apps
COPY libs ./libs
COPY tools ./tools

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# Build SPA first, then export OpenAPI, then build backend so the SPA dist and
# generated client are present in the workspace before the backend ts compile.
RUN npx nx run api-client:generate
RUN npx nx build frontend --configuration=production
RUN npx nx build backend  --configuration=production

# Place the SPA assets inside backend dist where ServeStaticModule expects them.
RUN mkdir -p apps/backend/dist/spa \
 && cp -R apps/frontend/dist/. apps/backend/dist/spa/

# Trim dev dependencies for the runtime stage.
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev


# ---------- stage 2 : runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/data \
    UV_THREADPOOL_SIZE=16 \
    NODE_OPTIONS=--enable-source-maps

# Run as non-root; /data is owned at runtime by the entrypoint volume mount.
RUN useradd -r -u 10001 -d /home/openbucket -m openbucket \
 && mkdir -p /data \
 && chown openbucket:openbucket /data

WORKDIR /app

COPY --from=build --chown=openbucket:openbucket /workspace/apps/backend/dist ./dist
COPY --from=build --chown=openbucket:openbucket /workspace/node_modules ./node_modules
COPY --from=build --chown=openbucket:openbucket /workspace/package.json ./package.json

USER openbucket

EXPOSE 9000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/api/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/main.js"]
```

**Why `bookworm-slim`, not `alpine`.** `better-sqlite3` ships prebuilt native bindings linked against glibc. On alpine (musl) those bindings are silently incompatible — npm falls back to building from source, which requires `python3`, `make`, and `g++` on both build *and* runtime stages, costs 30+ seconds, and produces an image only marginally smaller than `bookworm-slim`. `bookworm-slim` is ~85 MB; `alpine` with the toolchain ends up around 110 MB. The slim Debian base is the boring, correct choice. Do not change this without a benchmarked reason.

The healthcheck pings a tiny `GET /api/admin/health` endpoint (returns `{ status: 'ok' }`, public, no auth) — its implementation lives in a `HealthController` exported by `AdminModule` but marked `@Public()`.

---

## 5.18 `.dockerignore`

```
# Source control
.git
.gitignore
.gitattributes

# Editor / OS
.vscode
.idea
.DS_Store
Thumbs.db

# Nx / TS caches
.nx
.angular
dist
tmp
coverage
.cache

# Docs (not needed in the image)
docs
*.md
!README.md

# CI metadata
.github

# Node
node_modules
npm-debug.log*
yarn-debug.log*

# Tests
**/*.spec.ts
**/*.e2e-spec.ts
**/__tests__
**/__fixtures__

# Local env (never bake env files into images)
.env
.env.*
!.env.example

# Local data dirs accidentally created
data
local-data
```

Excluding `dist` is deliberate: the build stage produces its own `dist` from sources; a stale host-built `dist` must not leak in.

---

## 5.19 CI pipeline

```yaml
# .github/workflows/ci.yml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '22'

jobs:
  lint-and-test:
    name: lint + unit
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci --no-audit --no-fund

      - name: Derive nx affected base
        uses: nrwl/nx-set-shas@v4

      - name: Lint
        run: npx nx run-many --target=lint --all --parallel=4

      - name: Unit tests
        run: npx nx run-many --target=test --all --parallel=4 --ci --coverage

      - name: api-client freshness check
        run: npx nx run api-client:check

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  e2e:
    name: backend e2e (real sqlite)
    runs-on: ubuntu-22.04
    needs: lint-and-test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci --no-audit --no-fund
      - name: Prepare tmp data dir
        run: mkdir -p tmp/e2e-data
      - name: Run e2e
        env:
          DATA_DIR: ${{ github.workspace }}/tmp/e2e-data
          JWT_SECRET: test-secret-not-for-prod-not-for-prod
        run: npx nx run backend-e2e:e2e --ci

  build-image:
    name: build docker image
    runs-on: ubuntu-22.04
    needs: lint-and-test
    permissions:
      contents: read
      packages: write
    outputs:
      image-tag: ${{ steps.meta.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      - id: meta
        name: Compute image tag
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            echo "tag=pr-${{ github.event.pull_request.number }}-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
          else
            echo "tag=main-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
          fi

      - name: Build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile
          push: false
          load: true
          tags: openbucket:${{ steps.meta.outputs.tag }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Save image
        run: docker save openbucket:${{ steps.meta.outputs.tag }} -o /tmp/openbucket.tar

      - uses: actions/upload-artifact@v4
        with:
          name: docker-image
          path: /tmp/openbucket.tar
          retention-days: 7

  conformance:
    name: s3 conformance suite
    if: github.event_name == 'pull_request' || startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-22.04
    needs: build-image
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install client matrix
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends awscli s3cmd
          curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
          chmod +x /usr/local/bin/mc

      - uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load image
        run: docker load -i /tmp/openbucket.tar

      - run: npm ci --no-audit --no-fund

      - name: Run conformance suite
        env:
          OPENBUCKET_IMAGE: openbucket:${{ needs.build-image.outputs.image-tag }}
        run: npx nx run conformance:e2e --ci
```

The `conformance` job is gated to PRs targeting `main` and to tag pushes so day-to-day pushes pay the cheap `lint+test+e2e+build-image` chain only.

---

## 5.20 Testing patterns

### 5.20.1 Unit test — service with in-memory SQLite

The principle [see §7.1 of `BACKEND-DESIGN.md`]: do not mock the EntityManager. Boot MikroORM against `:memory:` per suite.

```ts
// apps/backend/src/domain/buckets/bucket.service.spec.ts
import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { BetterSqliteDriver } from '@mikro-orm/better-sqlite';

import { BucketService } from './bucket.service';
import { BucketEntity } from '../../persistence/entities/bucket.entity';

describe('BucketService', () => {
  let orm: MikroORM;
  let service: BucketService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot({
          driver: BetterSqliteDriver,
          dbName: ':memory:',
          entities: [BucketEntity],
          allowGlobalContext: true,
        }),
        MikroOrmModule.forFeature([BucketEntity]),
      ],
      providers: [BucketService],
    }).compile();

    orm = moduleRef.get(MikroORM);
    await orm.getSchemaGenerator().createSchema();
    service = moduleRef.get(BucketService);
  });

  afterEach(async () => {
    await orm.close(true);
  });

  it('creates a bucket with default versioning', async () => {
    const b = await service.create({ name: 'photos', region: 'us-east-1' });
    expect(b.name).toBe('photos');
    expect(b.versioning).toBe('disabled');
  });

  it('rejects duplicate bucket names', async () => {
    await service.create({ name: 'photos', region: 'us-east-1' });
    await expect(service.create({ name: 'photos', region: 'us-east-1' }))
      .rejects.toThrow(/already exists/i);
  });

  it('refuses to delete a non-empty bucket', async () => {
    await service.create({ name: 'photos', region: 'us-east-1' });
    // ...seed an object row via repository
    await expect(service.deleteByName('photos')).rejects.toThrow(/not empty/i);
  });
});
```

### 5.20.2 E2E test — supertest against a real Nest app

```ts
// apps/backend-e2e/src/admin-auth.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppModule } from '../../backend/src/app.module';
import { AdminUserRepository } from '../../backend/src/persistence/repositories/admin-user.repository';

describe('admin auth (e2e)', () => {
  let app: INestApplication;
  const dataDir = mkdtempSync(join(tmpdir(), 'ob-e2e-'));

  beforeAll(async () => {
    process.env.DATA_DIR = dataDir;
    process.env.JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e';
    process.env.ADMIN_PASSWORD_HASH = await argon2.hash('correct horse battery staple', {
      type: argon2.argon2id,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => app.close());

  it('logs in, refreshes, and rejects reuse', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ username: 'admin', password: 'correct horse battery staple' })
      .expect(200);

    expect(login.body.accessToken).toBeTruthy();
    const setCookie = login.headers['set-cookie'][0];
    expect(setCookie).toMatch(/ob_refresh=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);

    const refresh1 = await request(app.getHttpServer())
      .post('/api/admin/auth/refresh')
      .set('Cookie', setCookie)
      .expect(200);

    // Reusing the original refresh cookie must now fail and revoke the chain.
    await request(app.getHttpServer())
      .post('/api/admin/auth/refresh')
      .set('Cookie', setCookie)
      .expect(401);

    // The fresh cookie from refresh1 is also invalidated by the reuse detection.
    const reusedFresh = refresh1.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/api/admin/auth/refresh')
      .set('Cookie', reusedFresh)
      .expect(401);
  });

  it('protects /me with bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .expect(401);
  });
});
```

### 5.20.3 Conformance test — `@aws-sdk/client-s3` against the running image

The conformance project boots the container via `testcontainers`, points the AWS SDK at it, and exercises a matrix. One sample test:

```ts
// apps/conformance/src/object-roundtrip.conformance.ts
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import {
  S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';

describe('conformance: object roundtrip', () => {
  let container: StartedTestContainer;
  let s3: S3Client;

  beforeAll(async () => {
    container = await new GenericContainer(process.env.OPENBUCKET_IMAGE ?? 'openbucket:local')
      .withExposedPorts(9000)
      .withEnvironment({
        DATA_DIR: '/data',
        JWT_SECRET: 'conformance-secret-conformance-secret',
        ROOT_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        ROOT_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })
      .withWaitStrategy(Wait.forHttp('/api/admin/health', 9000).forStatusCode(200))
      .withStartupTimeout(60_000)
      .start();

    s3 = new S3Client({
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    });
  }, 90_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('puts, gets, and deletes a 4 MiB object with matching ETag', async () => {
    const bucket = 'roundtrip';
    const key = 'fixtures/blob.bin';
    const body = randomBytes(4 * 1024 * 1024);

    await s3.send(new CreateBucketCommand({ Bucket: bucket }));

    const put = await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body,
    }));
    expect(put.ETag).toMatch(/^"[0-9a-f]{32}"$/);

    const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const downloaded = Buffer.concat(await collect(get.Body as AsyncIterable<Uint8Array>));
    expect(downloaded.equals(body)).toBe(true);
    expect(get.ETag).toBe(put.ETag);

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  });
});

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return chunks;
}
```

A sibling matrix runs the same flow under `aws-cli`, `mc`, and `s3cmd` shelling out to the binaries installed in CI — those tests live in `apps/conformance/src/cli-matrix/*.conformance.ts` and are mostly assertions over `execFile` output. The `OPENBUCKET_IMAGE` env var is set by the CI workflow (§5.19) so the same suite runs against the just-built PR image.
