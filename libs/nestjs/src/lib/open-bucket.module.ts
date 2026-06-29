import { DynamicModule, Module, type Type } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';

import { ADMIN_CONTROLLER_MODULES } from './admin/admin.module';
import { HealthModule } from './admin/health/health.module';
import { DomainModule } from './domain/domain.module';
import { OpenBucketCoreModule, OpenBucketHeadlessCoreModule } from './open-bucket-core.module';
import {
  normalizeMount,
  OPEN_BUCKET_OPTIONS,
  OpenBucketModuleAsyncOptions,
  OpenBucketModuleOptions,
  resolveOptions,
} from './open-bucket-options';
import { OpenBucketService } from './open-bucket.service';
import { S3Module } from './s3/s3.module';
import { SpaModule } from './spa/spa.module';

/**
 * Mount the OpenBucket controller tree under `mountPath` (path-style). `coreModule`
 * is the composition root being mounted — with or without admin, matching
 * `adminEnabled`. The SPA (`<mountPath>/admin`) sits before S3 so it wins over the
 * greedy `:bucket` route; S3 is last. Empty `mountPath` (the standalone app boots
 * the core module directly, SPA served by main.ts) needs no router registration.
 * Admin controllers + SPA are listed as children only when the admin surface is
 * enabled — matching the conditional `AdminModule` import in the core module.
 */
function mountUnder(
  coreModule: Type,
  mountPath: string,
  adminEnabled: boolean,
  serveUi: boolean,
): DynamicModule[] {
  if (!mountPath) return [];
  // List the modules that DECLARE controllers — RouterModule only prefixes a
  // listed module's own controllers (not those of modules it imports). AdminModule
  // has none of its own; its controllers live in ADMIN_CONTROLLER_MODULES.
  const children = [
    ...(adminEnabled ? ADMIN_CONTROLLER_MODULES : []),
    HealthModule,
    ...(serveUi ? [SpaModule] : []),
    S3Module,
  ];
  return [RouterModule.register([{ path: mountPath, module: coreModule, children }])];
}

/**
 * `@openbucket/nestjs` — drop OpenBucket's S3 wire protocol, admin JSON API, and
 * admin SPA into any host NestJS application:
 *
 * ```ts
 * @Module({ imports: [OpenBucketModule.forRoot({ dataDir: '/data', rootCredentials: {…} })] })
 * export class AppModule {}
 * ```
 *
 * Everything mounts under `options.mountPath` (default `/storage`) so it coexists
 * with the host's own routes. See `docs/PACKAGING-PLAN.md`.
 *
 * NOTE (build-out in progress): this `forRoot` currently provides the resolved
 * options token only. The feature modules (S3 / Admin / Storage / persistence)
 * are imported here once they are extracted from the standalone app and rewired
 * to read `OPEN_BUCKET_OPTIONS` instead of env (plan phases 0b → 5).
 */
@Module({})
export class OpenBucketModule {
  static forRoot(options: OpenBucketModuleOptions): DynamicModule {
    const resolved = resolveOptions(options);
    // Admin is opt-in: present `admin` ⇒ the JSON API + JWT guard + bootstrap are
    // wired (OpenBucketCoreModule); absent ⇒ none of them are, the SPA is never
    // served, and the headless core is mounted instead.
    const adminEnabled = !!resolved.admin;
    const coreModule = adminEnabled ? OpenBucketCoreModule : OpenBucketHeadlessCoreModule;
    const serveUi = adminEnabled && (resolved.admin?.serveUi ?? false);
    const optionsProvider = { provide: OPEN_BUCKET_OPTIONS, useValue: resolved };
    return {
      module: OpenBucketModule,
      // Global so OPEN_BUCKET_OPTIONS is visible to the (descendant) dual-mode
      // ConfigModule factory, not just the host's root module.
      global: true,
      imports: [
        coreModule,
        // DomainModule (shared singleton with the core graph) supplies ObjectService
        // + BucketService for the facade below; importing it here lets OpenBucketModule
        // own the facade provider and export it to the host.
        DomainModule,
        ...(serveUi ? [SpaModule] : []),
        ...mountUnder(coreModule, resolved.mountPath, adminEnabled, serveUi),
      ],
      // The in-process facade is OpenBucketModule's own provider (deps resolved from
      // the imported DomainModule + the global ORM/config), so it can be exported to
      // the host app for injection.
      providers: [optionsProvider, OpenBucketService],
      exports: [optionsProvider, OpenBucketService],
    };
  }

  static forRootAsync(options: OpenBucketModuleAsyncOptions): DynamicModule {
    // Whether the admin surface exists is a routing decision wired at module-config
    // time, so it is STATIC (default on). The admin SECRETS still come from the async
    // factory; the factory must return an `admin` block unless `admin: false` here.
    const adminEnabled = options.admin ?? true;
    const coreModule = adminEnabled ? OpenBucketCoreModule : OpenBucketHeadlessCoreModule;
    const optionsProvider = {
      provide: OPEN_BUCKET_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const resolved = resolveOptions(await options.useFactory(...args));
        if (adminEnabled && !resolved.admin) {
          throw new Error(
            'OpenBucketModule.forRootAsync: the admin surface is enabled but the factory ' +
              'returned no `admin` config. Return an `admin` block, or pass `admin: false` ' +
              'to disable the admin surface.',
          );
        }
        return resolved;
      },
      inject: options.inject ?? [],
    };
    const serveUi = adminEnabled && (options.serveUi ?? true);
    return {
      module: OpenBucketModule,
      global: true,
      imports: [
        ...(options.imports ?? []),
        coreModule,
        DomainModule,
        ...(serveUi ? [SpaModule] : []),
        ...mountUnder(
          coreModule,
          normalizeMount(options.mountPath ?? '/storage'),
          adminEnabled,
          serveUi,
        ),
      ],
      providers: [optionsProvider, OpenBucketService],
      exports: [optionsProvider, OpenBucketService],
    };
  }
}
