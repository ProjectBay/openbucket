export { OpenBucketModule } from './lib/open-bucket.module';
export {
  OPEN_BUCKET_OPTIONS,
  type OpenBucketModuleOptions,
  type OpenBucketModuleAsyncOptions,
  type OpenBucketOptionsFactory,
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
  type CreateBucketOptions,
  type PutObjectOptions,
  type ListObjectsOptions,
  type PresignOptions,
  type PresignPostOptions,
  type PresignedPost,
  type MulterFileLike,
  type UploadSource,
  type UploadOptions,
  type UploadedObject,
  type UploadResult,
  type PostPolicyCondition,
} from './lib/open-bucket.service';

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

// NOTE: the composition-root internals the first-party standalone backend needs
// to bootstrap OpenBucket from the published package — `OpenBucketCoreModule`,
// `OpenBucketStandaloneModule`, `AdminModule`, `HealthModule`, `AppConfigService`,
// `normalizeMount`, `rewriteBaseHref`, and `OPEN_BUCKET_ORM_CONTEXT` — are NOT
// host-app API and are intentionally NOT exported here. Import them from the
// `@openbucket/nestjs/standalone` SUBPATH instead (see `standalone.ts`).

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

// The multer storage engine + `@UploadedToBucket()` decorator + upload-validation
// filter live behind the `@openbucket/nestjs/multer` SUBPATH export (STORY-1200).
// They are intentionally NOT re-exported here: importing them drags `multer` (an
// optional peer) into the `.` entry's type graph, which headless / non-Express
// hosts must not pay for. Import them from `@openbucket/nestjs/multer` instead.
