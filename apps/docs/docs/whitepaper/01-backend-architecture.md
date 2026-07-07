---
description: OpenBucket backend architecture — how a single NestJS process boots and multiplexes S3, admin API, and SPA traffic onto one port.
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
5. Close MikroORM (flush WAL, close libsql).
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
