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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AppConfigService,
  OpenBucketCoreModule,
  OpenBucketStandaloneModule,
  OPEN_BUCKET_ORM_CONTEXT,
  normalizeMount,
  rewriteBaseHref,
} from '@openbucket/nestjs/standalone';
import { configureBodyParsers } from './bootstrap/body-parser';

async function bootstrap(): Promise<void> {
  const expressInstance: Express = express();

  // Optional subpath the whole server mounts under (S3 + admin API + admin SPA +
  // health/metrics), for running behind a reverse proxy at e.g.
  // `https://example.com/storage/…`. Read straight from process.env here because
  // it must be known BEFORE the module graph is built (RouterModule wires the
  // prefix at module-config time, before ConfigService exists). Normalized with
  // the SAME helper the env schema uses, so both agree. Empty ⇒ root (unchanged).
  const mountPath = normalizeMount(process.env.MOUNT_PATH ?? '');
  // NOTE (trusted-proxy `X-Forwarded-Prefix`): MOUNT_PATH is intentionally the
  // single, authoritative prefix. Route registration is wired ONCE at boot
  // (RouterModule) and the admin JWT guard's prefix is derived from it, so a
  // per-request forwarded header could not relocate the guarded routes and would
  // be a footgun (a spoofed prefix must never move the admin API out from under
  // its guard). If forwarded-prefix awareness is ever needed, gate it strictly on
  // Express `trust proxy` AND keep MOUNT_PATH authoritative for routing — do not
  // let the header override it. Left as a deliberate non-feature for now.
  // Root: boot the core module directly (the pre-existing path, unchanged). Under
  // a mount: the standalone wrapper prefixes every route via RouterModule and
  // provides the mount-aware OPEN_BUCKET_OPTIONS token. See OpenBucketStandaloneModule.
  const rootModule = mountPath
    ? OpenBucketStandaloneModule.forRoot(mountPath)
    : OpenBucketCoreModule;

  // Disable Express's defaults. Body parsing is opt-in per route (§1.2.3).
  expressInstance.disable('x-powered-by');
  expressInstance.disable('etag'); // we issue our own ETags for objects
  expressInstance.set('trust proxy', 'loopback'); // upstream TLS-terminating proxy
  // Case-sensitive routing (defense-in-depth for the admin-guard case bug,
  // TASK-2100/TASK-2110): a mixed-case `/api/Admin/*` no longer matches the
  // literal admin controller routes and falls through to the SigV4-guarded S3
  // tree instead of reaching an admin handler. The JwtAuthGuard's lower-cased
  // prefix test remains the primary control; this removes the case-variant path
  // as a way to reach admin handlers at all. Strict routing is deliberately left
  // off — S3 treats `/bucket` and `/bucket/` as equivalent.
  expressInstance.set('case sensitive routing', true);

  const app = await NestFactory.create<NestExpressApplication>(
    // The standalone app always serves the admin surface — the env schema (§1.7)
    // requires JWT_SECRET + ADMIN_PASSWORD_HASH, so admin is never headless here.
    // At root this is OpenBucketCoreModule; under a MOUNT_PATH it is the wrapper
    // that prefixes the whole tree (see above).
    rootModule,
    new ExpressAdapter(expressInstance),
    {
      bufferLogs: true, // hold logs until Pino is bound
      rawBody: false, // raw body opt-in via interceptors (S3 PUT streams req directly)
      bodyParser: false, // see §1.2.3
    },
  );

  // Bind Pino as the application logger. nestjs-pino is registered in AppModule.
  app.useLogger(app.get(Logger));

  // Security headers (TASK-2110, CWE-79). Restore a restrictive default CSP for
  // the admin SPA/API (`default-src 'self'`) instead of disabling it entirely.
  // `style-src` allows inline styles (Angular injects component styles inline)
  // and `img-src` allows data:/blob: (object previews). No
  // `upgrade-insecure-requests` — the app may run over plain HTTP behind a
  // TLS-terminating loopback proxy. Raw S3 object responses override this with a
  // stricter per-response `default-src 'none'; sandbox` in ObjectService.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'font-src': ["'self'", 'data:'],
          'form-action': ["'self'"],
          'frame-ancestors': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'object-src': ["'none'"],
          'script-src': ["'self'"],
          'script-src-attr': ["'none'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'connect-src': ["'self'"],
        },
      },
    }),
  );

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
    // Mount the SPA under `<mountPath>/admin` (root ⇒ `/admin`, unchanged). Hashed
    // assets are served straight from disk; `index: false` routes the shell
    // through the handler below so its `<base href>` is rewritten to
    // `<mountPath>/admin/` — the SAME rewrite the embedded SpaController applies,
    // reused here (a no-op at root, where the build-time href is already
    // `/admin/`). The shell is read + rewritten once at boot (the bundle is
    // immutable). Registered BEFORE app.listen() maps the greedy S3 `:bucket`
    // routes, so `<mountPath>/admin/*` wins over an S3 bucket named "admin".
    const adminBase = `${mountPath}/admin`;
    const shellHtml = rewriteBaseHref(readFileSync(indexHtml, 'utf8'), mountPath);
    expressInstance.use(
      adminBase,
      express.static(spaRoot, { index: false, setHeaders: cacheHeaders }),
    );
    // The mount root + any unmatched client-side route under it → the SPA shell.
    expressInstance.get([adminBase, `${adminBase}/{*splat}`], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.type('html').send(shellHtml);
    });
  }

  // Allow ConfigService access before listen().
  const config = app.get(AppConfigService);

  // Tune the underlying http.Server (WHITEPAPER §4.5). TASK-2111 (CWE-400)
  // supersedes STORY-0309's blanket `0`/`0`: unbounded per-request and socket
  // timeouts let a slow-body client (e.g. a drip-fed `POST /api/admin/auth/login`)
  // pin a socket forever (slowloris/RUDY). Restore finite bounds; legitimate long
  // streaming PUTs are protected by a per-request stall watchdog in
  // PutObjectInterceptor (which re-arms on every received chunk) rather than by
  // disabling every timeout server-wide.
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 300_000; // 5-min hard per-request completion deadline (Node default)
  httpServer.headersTimeout = 60_000; // 60s to send full request headers
  httpServer.keepAliveTimeout = 75_000; // > headersTimeout; friendly with HTTP/1.1 keep-alive
  httpServer.timeout = 120_000; // socket inactivity timeout (was 0 = disabled)
  httpServer.maxRequestsPerSocket = 0; // no per-socket request cap (keep-alive friendly)
  httpServer.maxConnections = 1024; // ceiling on concurrent sockets (slow-client blast radius)

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
