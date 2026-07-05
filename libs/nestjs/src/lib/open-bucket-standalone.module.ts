import { DynamicModule, Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';

import { ADMIN_CONTROLLER_MODULES } from './admin/admin.module';
import { HealthModule } from './admin/health/health.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { OpenBucketCoreModule } from './open-bucket-core.module';
import {
  normalizeMount,
  OPEN_BUCKET_OPTIONS,
  type ResolvedOpenBucketOptions,
} from './open-bucket-options';
import { S3Module } from './s3/s3.module';

/**
 * Root module for the STANDALONE server (`apps/openbucket-backend`) when it runs
 * under a `MOUNT_PATH` subpath. It reuses the SAME mount machinery the embedded
 * `OpenBucketModule.forRoot` uses — a `RouterModule` prefix over the exact set of
 * controller-declaring modules — so no route wiring is duplicated:
 *
 * - `RouterModule.register` prefixes each listed child module's OWN controllers
 *   with `<mountPath>` (the admin JSON API, health, `/metrics`, and the greedy
 *   S3 `:bucket` tree last). Those modules are imported transitively by
 *   {@link OpenBucketCoreModule}; they are listed as children here purely to move
 *   their routes under the prefix. The admin SPA is served from the raw Express
 *   instance in `main.ts` (mount-aware, with the `<base href>` rewritten via the
 *   library's `rewriteBaseHref`), so `SpaModule` is intentionally NOT a child.
 *
 * - The mount-only `OPEN_BUCKET_OPTIONS` provider makes every mount-aware
 *   consumer (`RequestClassifierMiddleware`, `JwtAuthGuard`, `RolesGuard`, the
 *   `AuthController` refresh-cookie scope, the S3 presign base path, …) read
 *   `<mountPath>` from the same DI token the library populates — so the admin API
 *   stays guarded at `<mountPath>/api/admin/*` and S3 classifies correctly under
 *   the prefix, with zero per-consumer changes. It carries ONLY `mountPath` (no
 *   `rootCredentials`), which is the standalone marker the dual-mode
 *   `ConfigModule` uses to keep sourcing the rest of config from `process.env`
 *   (see `config-source.ts`). The provider is `global` so it reaches the deep
 *   consumers inside the core-module subtree (mirrors `forRoot`).
 *
 * When `MOUNT_PATH` is unset/root, `main.ts` boots {@link OpenBucketCoreModule}
 * directly instead — this wrapper is only used for a non-empty prefix, so the
 * root deployment is byte-for-byte unchanged.
 */
@Module({})
export class OpenBucketStandaloneModule {
  /**
   * @param rawMountPath the raw `MOUNT_PATH` value (normalized here). Callers pass
   * a non-empty prefix; an empty/root value returns a plain wrapper around the
   * core module with no prefixing (defensive — `main.ts` handles root directly).
   */
  static forRoot(rawMountPath: string): DynamicModule {
    const mountPath = normalizeMount(rawMountPath);
    if (!mountPath) {
      return { module: OpenBucketStandaloneModule, imports: [OpenBucketCoreModule] };
    }

    const optionsProvider = {
      provide: OPEN_BUCKET_OPTIONS,
      // Mount-only marker (no rootCredentials → config still sourced from env).
      useValue: { mountPath } as ResolvedOpenBucketOptions,
    };

    return {
      module: OpenBucketStandaloneModule,
      global: true,
      imports: [
        OpenBucketCoreModule,
        RouterModule.register([
          {
            path: mountPath,
            module: OpenBucketCoreModule,
            // Every module that DECLARES controllers, so RouterModule prefixes
            // them. S3Module (greedy `:bucket`) stays last, matching the core
            // module's own import order. SpaModule is omitted — the SPA is served
            // by Express in main.ts.
            children: [...ADMIN_CONTROLLER_MODULES, HealthModule, MetricsModule, S3Module],
          },
        ]),
      ],
      providers: [optionsProvider],
      exports: [optionsProvider],
    };
  }
}
