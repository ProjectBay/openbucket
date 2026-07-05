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
  type PresignPostOptions,
  type PresignedPost,
  type MulterFileLike,
  type UploadSource,
  type UploadOptions,
  type UploadResult,
} from './lib/open-bucket.service';
export { type PostPolicyCondition } from './lib/s3/sigv4/presigned-post';

// Upload DX helpers (STORY-0803): validation model + sanitized key strategies +
// the typed validation error hosts map to a 400.
export {
  UploadValidationError,
  type UploadValidateOptions,
  type UploadValidationCode,
  type KeyStrategy,
  type KeyStrategyName,
  type KeyStrategyContext,
  type SniffMode,
} from './lib/open-bucket-upload';
export { type ImageInfo } from './lib/storage/image-info';

// The composition root (env-driven in phase 0b; phase 1 wires it to options).
// Exported so the thin standalone app + the openapi-export tooling can bootstrap it.
export { OpenBucketCoreModule } from './lib/open-bucket-core.module';
export { AdminModule } from './lib/admin/admin.module';
export { HealthModule } from './lib/admin/health/health.module';

// Standalone `MOUNT_PATH` support: the wrapper root module that mounts the whole
// tree under a subpath, plus the two pure helpers `main.ts` needs to be
// mount-aware without duplicating logic — `normalizeMount` (the same
// normalization the env schema + `forRoot` apply) and `rewriteBaseHref` (the SPA
// `<base href>` rewrite the embedded SpaController uses).
export { OpenBucketStandaloneModule } from './lib/open-bucket-standalone.module';
export { normalizeMount } from './lib/open-bucket-options';
export { rewriteBaseHref } from './lib/spa/spa-utils';

// Config service consumed by the standalone app's main.ts (phase 0b).
export { AppConfigService } from './lib/common/config/app-config.service';

// Prometheus metrics (STORY-1202). Exported so a host app can scrape the shared
// `prom-client` registry directly (e.g. bolt it onto its own `/metrics` route)
// instead of, or in addition to, the guarded `<mountPath>/metrics` endpoint.
export {
  METRICS_REGISTRY,
  PROM_METRICS,
  type PromMetrics,
} from './lib/common/metrics/metrics.registry';

// Object-event notifications (STORY-0801). Host apps register in-process handlers
// with the decorators and may inject ObjectEventsService directly.
export {
  OBJECT_EVENTS,
  type ObjectEvent,
  type ObjectEventType,
} from './lib/events/object-event.types';
export {
  OnObjectCreated,
  OnObjectDeleted,
  OnMultipartCompleted,
} from './lib/events/on-object-event.decorators';
export { ObjectEventsService } from './lib/events/object-events.service';

// The MikroORM contextName the lib registers under (phase 5 isolation). The
// standalone app needs it to resolve the named ORM token in main.ts; a host
// must not register its own MikroORM context with this name.
export { OPEN_BUCKET_ORM_CONTEXT } from './lib/persistence/orm-context';

// The multer storage engine + `@UploadedToBucket()` decorator + upload-validation
// filter live behind the `@openbucket/nestjs/multer` SUBPATH export (STORY-1200).
// They are intentionally NOT re-exported here: importing them drags `multer` (an
// optional peer) into the `.` entry's type graph, which headless / non-Express
// hosts must not pay for. Import them from `@openbucket/nestjs/multer` instead.
