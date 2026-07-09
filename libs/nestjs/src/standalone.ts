/**
 * `@openbucket/nestjs/standalone` — composition-root internals.
 *
 * These symbols exist ONLY so the first-party standalone backend (and the
 * openapi-export tooling) can bootstrap OpenBucket from the published package.
 * They are NOT part of the host-app API surface (`OpenBucketModule.forRoot(…)` +
 * `OpenBucketService`) and are intentionally kept OFF the main `.` entry so they
 * are not frozen as public API: the composition-root modules, the env-driven
 * `AppConfigService`, the admin/health module handles used by the OpenAPI export,
 * the two mount helpers `main.ts` needs, and the named ORM context token.
 *
 * Host apps should NOT import from here — use the `.` entry.
 */
export { OpenBucketCoreModule } from './lib/open-bucket-core.module';
export { OpenBucketStandaloneModule } from './lib/open-bucket-standalone.module';
export { AdminModule } from './lib/admin/admin.module';
export { HealthModule } from './lib/admin/health/health.module';

// The two pure helpers `main.ts` needs to be mount-aware without duplicating
// logic — `normalizeMount` (the same normalization the env schema + `forRoot`
// apply) and `rewriteBaseHref` (the SPA `<base href>` rewrite the embedded
// SpaController uses).
export { normalizeMount } from './lib/open-bucket-options';
export { rewriteBaseHref } from './lib/spa/spa-utils';

// Config service consumed by the standalone app's main.ts (phase 0b).
export { AppConfigService } from './lib/common/config/app-config.service';

// The MikroORM contextName the lib registers under (phase 5 isolation). The
// standalone app needs it to resolve the named ORM token in main.ts; a host
// must not register its own MikroORM context with this name.
export { OPEN_BUCKET_ORM_CONTEXT } from './lib/persistence/orm-context';
