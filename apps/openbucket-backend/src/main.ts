// MUST be the first import: sizes the libuv thread pool before any module
// that touches it is evaluated. See WHITEPAPER §4.6 (STORY-0310).
import './bootstrap/uv-threadpool';

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { MikroORM } from '@mikro-orm/core';
import { getMikroORMToken } from '@mikro-orm/nestjs';
import { Logger } from 'nestjs-pino';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AppConfigService, OpenBucketCoreModule, OPEN_BUCKET_ORM_CONTEXT } from '@openbucket/nestjs';
import { configureBodyParsers } from './bootstrap/body-parser';

async function bootstrap(): Promise<void> {
  const expressInstance: Express = express();

  // Disable Express's defaults. Body parsing is opt-in per route (§1.2.3).
  expressInstance.disable('x-powered-by');
  expressInstance.disable('etag'); // we issue our own ETags for objects
  expressInstance.set('trust proxy', 'loopback'); // upstream TLS-terminating proxy

  const app = await NestFactory.create<NestExpressApplication>(
    // The standalone app always serves the admin surface — the env schema (§1.7)
    // requires JWT_SECRET + ADMIN_PASSWORD_HASH, so admin is never headless here.
    OpenBucketCoreModule,
    new ExpressAdapter(expressInstance),
    {
      bufferLogs: true, // hold logs until Pino is bound
      rawBody: false, // raw body opt-in via interceptors (S3 PUT streams req directly)
      bodyParser: false, // see §1.2.3
    },
  );

  // Bind Pino as the application logger. nestjs-pino is registered in AppModule.
  app.useLogger(app.get(Logger));

  // Security headers — harmless on S3, useful on /admin SPA.
  app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled; SPA + S3 set their own headers

  // Mount opt-in body parsers for admin routes only. S3 PUTs stay raw.
  configureBodyParsers(expressInstance);

  // Serve the Angular admin SPA under /admin. Registered on the raw Express
  // instance now — BEFORE app.listen() maps the greedy S3 `:bucket` controller
  // routes — so `/admin/*` resolves to the SPA, not an S3 bucket named "admin".
  // (@nestjs/serve-static registers after the controller routes in the Express 5
  // stack and lost that race; STORY-0013 + Docker image smoke fix.) The dist/spa
  // directory is populated at Docker build time and is absent in local dev, so
  // registration is guarded.
  const spaRoot = join(__dirname, '..', 'spa');
  if (existsSync(spaRoot)) {
    const indexHtml = join(spaRoot, 'index.html');
    const cacheHeaders = (res: express.Response, filePath: string): void => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (
        // Content-hashed bundles → immutable. Angular v21 emits `name-HASH.ext`
        // (uppercase-alphanumeric hash, e.g. `main-UZ7C7DZ3.js`); match a `.`/`-`
        // separator + 8+ char alnum hash, not lowercase-hex-only (which matched
        // no real Angular asset and downgraded them all to the short cache).
        /[.-][a-z0-9]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/i.test(
          filePath,
        )
      ) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
    };
    expressInstance.use(
      '/admin',
      express.static(spaRoot, { index: 'index.html', setHeaders: cacheHeaders }),
    );
    // SPA client-side routing: any unmatched /admin/* path falls back to the shell.
    expressInstance.get('/admin/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(indexHtml);
    });
  }

  // Allow ConfigService access before listen().
  const config = app.get(AppConfigService);

  // Tune the underlying http.Server for long-lived multipart streams.
  // Values per WHITEPAPER §4.5 (the dedicated timeout-calibration section,
  // authoritative over §1.2's inline 65_000): a slow multi-GB PUT must never
  // be cut off by a per-request or socket-inactivity timeout.
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 0; // disable per-request timeout; streaming sets its own
  httpServer.headersTimeout = 60_000; // 60s to send full request headers
  httpServer.keepAliveTimeout = 75_000; // > headersTimeout; friendly with HTTP/1.1 keep-alive
  httpServer.timeout = 0; // no socket inactivity timeout; streams set their own
  httpServer.maxRequestsPerSocket = 0;

  // Run forward-only migrations before the listener binds (§3.3.2): an empty
  // DATA_DIR becomes a usable instance with no manual SQL.
  const migrated = await app
    .get<MikroORM>(getMikroORMToken(OPEN_BUCKET_ORM_CONTEXT))
    .getMigrator()
    .up();
  app
    .get(Logger)
    .log(
      `Database migrations up to date (${migrated.length} applied this boot)`,
      'Bootstrap',
    );

  // Graceful shutdown (§4.12). Nest's shutdown hooks fire OnApplicationShutdown
  // on SIGINT/SIGTERM; ShutdownService (AppModule) runs the deterministic
  // 5-step drain there, then Nest re-raises the signal to terminate. This
  // supersedes the M0 §1.10 signal coordinator (STORY-0319 / STORY-0015).
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  await app.listen(config.port, '0.0.0.0');

  const url = await app.getUrl();
  const logger = app.get(Logger);
  logger.log(`OpenBucket listening on ${url}`, 'Bootstrap');
  logger.log(`libuv thread pool size: ${process.env.UV_THREADPOOL_SIZE}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // Pino isn't bound yet if this throws during NestFactory.create; use stderr.
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
