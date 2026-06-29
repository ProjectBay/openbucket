export { OpenBucketModule } from './lib/open-bucket.module';
export {
  OPEN_BUCKET_OPTIONS,
  type OpenBucketModuleOptions,
  type OpenBucketModuleAsyncOptions,
  type ResolvedOpenBucketOptions,
} from './lib/open-bucket-options';

// The host-facing, in-process object-store facade (upload / read / list / delete /
// buckets / presigned URLs) and its result + option types.
export {
  OpenBucketService,
  type PutObjectResult,
  type ObjectListEntry,
  type ObjectListResult,
  type ObjectInfo,
  type BucketInfo,
  type PresignOptions,
} from './lib/open-bucket.service';

// The composition root (env-driven in phase 0b; phase 1 wires it to options).
// Exported so the thin standalone app + the openapi-export tooling can bootstrap it.
export { OpenBucketCoreModule } from './lib/open-bucket-core.module';
export { AdminModule } from './lib/admin/admin.module';
export { HealthModule } from './lib/admin/health/health.module';

// Config service consumed by the standalone app's main.ts (phase 0b).
export { AppConfigService } from './lib/common/config/app-config.service';

// The MikroORM contextName the lib registers under (phase 5 isolation). The
// standalone app needs it to resolve the named ORM token in main.ts; a host
// must not register its own MikroORM context with this name.
export { OPEN_BUCKET_ORM_CONTEXT } from './lib/persistence/orm-context';
