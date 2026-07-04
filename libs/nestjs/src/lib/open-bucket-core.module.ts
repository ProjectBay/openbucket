import {
  type DynamicModule,
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
  type Type,
} from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { ConfigModule } from './common/config/config.module';
import { AppConfigService } from './common/config/app-config.service';
import { CommonModule } from './common/common.module';
import { ClockModule } from './common/clock/clock.module';
import { PersistenceModule } from './persistence.module';
import { EventsModule } from './events/events.module';
import { StorageModule } from './storage/storage.module';
import { DomainModule } from './domain/domain.module';
import { BackgroundModule } from './common/background/background.module';
import { ShutdownModule } from './common/shutdown/shutdown.module';
import { S3Module } from './s3/s3.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './admin/health/health.module';
import { TestModule } from './admin/_test/test.module';
import { RequestClassifierMiddleware } from './common/middleware/request-classifier.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { OrmContextMiddleware } from './common/middleware/orm-context.middleware';
import { stripSigV4QueryAuth } from './s3/sigv4/presigned';

/**
 * Build the ordered import list for the composition root. Order matters: config
 * first, logger second, then cross-cutting, then the lower layers, then the
 * controller trees with the greedy S3 `:bucket` routes LAST so they can't shadow
 * `/api/admin/*` (or, in the standalone app, `/admin/*`).
 *
 * The admin surface — the `/api/admin/*` JSON API, the global `JwtAuthGuard`, and
 * the first-run `AdminBootstrapService` — is **opt-in** via `adminEnabled`. The
 * flag is fixed per concrete module class (see below) rather than passed at
 * runtime: both classes are plain static `@Module`s so Nest registers their
 * routes deterministically (a dynamic module reorders under a host's `@Global`
 * MikroORM, breaking the mounted admin routes). When admin is disabled,
 * `AdminModule` is never imported, so no admin route is mapped, no global JWT
 * guard is bound, and the bootstrap never seeds a user — omitting `admin` can't
 * leave the API reachable or sign tokens with an empty secret.
 *
 * Persistence (PersistenceModule, §3.1.2) is wired as of M1/STORY-0205: it opens
 * the SQLite DB under DATA_DIR and the bootstrap runs migrations before the
 * listener binds (see main.ts).
 */
function buildCoreImports(adminEnabled: boolean): Array<Type | DynamicModule> {
  return [
    // 1. Config first — every other module reads it. Dual-mode (@Global): reads
    //    OPEN_BUCKET_OPTIONS when present (host forRoot), else loadEnv(process.env)
    //    for the standalone app. Replaces @nestjs/config ConfigModule.forRoot.
    ConfigModule,

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
              // Webhook HMAC secret (STORY-0801). Defence-in-depth: the secret
              // lives only in config and is never intentionally logged, but redact
              // any field named `webhookSecret` (top-level or one level deep) so a
              // stray config dump can't leak it (EPIC-08 / STORY-0705 secrets hygiene).
              'webhookSecret',
              '*.webhookSecret',
            ],
            censor: '[redacted]',
          },
          serializers: {
            req: (req) => ({
              method: req.method,
              // Strip SigV4 query-auth params (X-Amz-Signature / -Credential /
              // -Security-Token) so a presigned request never logs a replayable
              // signature or the access-key-id (CWE-532, TASK-2150). pino `redact`
              // can't censor a substring inside the opaque `url` string, so the
              // sanitization must happen here in the serializer.
              url: stripSigV4QueryAuth(req.url ?? ''),
              host: req.headers.host,
              remoteAddress: req.remoteAddress,
            }),
          },
          // No pino-pretty in production — Docker captures stdout JSON.
          transport:
            config.nodeEnv === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),

    // 3. Cross-cutting (filters, pipes, interceptors). Global by virtue of providers.
    CommonModule,

    // 3a. Global Clock (SystemClock in prod, TestClock when OPENBUCKET_TEST_MODE=1).
    ClockModule,

    // 3b. In-process object-event core (STORY-0801). @Global, so the writer
    //     (StorageModule) and ObjectService (DomainModule) can inject
    //     ObjectEventsService below without an import cycle. Calls
    //     EventEmitterModule.forRoot() exactly once app-wide.
    EventsModule,

    // 4. Lower layers. PersistenceModule is live (EPIC-03); Storage/Domain
    //    remain placeholders until later EPIC-03/02 stories fill them.
    PersistenceModule,
    StorageModule,
    DomainModule,

    // In-process background tick scheduler (§4.9). Recurring runners register
    // themselves; on its own it schedules nothing.
    BackgroundModule,

    // §4.12 graceful-shutdown coordinator. Runs the 5-step ordering via Nest's
    // OnApplicationShutdown hook (main.ts enables shutdown hooks); supersedes
    // the M0 §1.10 signal coordinator (STORY-0015).
    ShutdownModule,

    // 5. Controller trees + health probes. Admin (when enabled) + health + test
    //    routes go first so the S3 wildcard routes (`@Controller(':bucket')`)
    //    below can't shadow `/api/admin/*` or `/admin/_test/*` (per WHITEPAPER
    //    §2.1 "S3 module is mounted last").
    ...(adminEnabled ? [AdminModule] : []),
    HealthModule,

    // Test-only routes — gated; never present in production. Read straight
    // from process.env (not ConfigService) since it's a build-time gate.
    ...(process.env.OPENBUCKET_TEST_MODE === '1' ? [TestModule] : []),

    // 5b. S3 wire-protocol last among controller trees; its `:bucket` /
    //    `:bucket/*` routes are deliberately greedy and sit at the bottom.
    //    The Angular admin SPA (/admin) is served directly from the Express
    //    instance in main.ts — registered BEFORE these routes are mapped — so
    //    `/admin/*` resolves to the SPA instead of being swallowed as a bucket
    //    named "admin". (@nestjs/serve-static registered too late in the
    //    Express 5 stack to win that race; see main.ts.)
    S3Module,
  ];
}

/**
 * Apply the cross-cutting middleware. Order: OrmContextMiddleware opens the
 * per-request MikroORM RequestContext for the named ORM FIRST (everything
 * downstream runs inside it), then request-id assigns req.openbucket.requestId,
 * then the classifier populates the rest of req.openbucket.
 */
function applyCoreMiddleware(consumer: MiddlewareConsumer): void {
  consumer
    .apply(OrmContextMiddleware, RequestIdMiddleware, RequestClassifierMiddleware)
    .forRoutes({ path: '*', method: RequestMethod.ALL });
}

/**
 * Composition root WITH the admin surface. Used by the standalone app
 * (`main.ts`), the OpenAPI export, and `OpenBucketModule.forRoot` whenever a host
 * passes an `admin` block.
 */
@Module({ imports: buildCoreImports(true) })
export class OpenBucketCoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    applyCoreMiddleware(consumer);
  }
}

/**
 * Composition root WITHOUT the admin surface — a headless, S3-only store. Used by
 * `OpenBucketModule.forRoot` when the host omits `admin`. Identical to
 * {@link OpenBucketCoreModule} minus `AdminModule`; a distinct class so Nest /
 * `RouterModule` route it independently.
 */
@Module({ imports: buildCoreImports(false) })
export class OpenBucketHeadlessCoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    applyCoreMiddleware(consumer);
  }
}
