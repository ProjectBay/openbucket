import type { ResolvedOpenBucketOptions } from '../../open-bucket-options';
import { type Env, loadEnv } from './env.schema';

/**
 * The single place config is sourced. Dual-mode:
 *
 * - **Library** — when a host imports `OpenBucketModule.forRoot(options)`, the
 *   resolved options are mapped to the flat config shape `ConfigService` reads.
 * - **Standalone** — when bootstrapped without options (the thin app boots
 *   `OpenBucketCoreModule` directly), fall back to `loadEnv(process.env)` so the
 *   env-var/refuse-to-boot path is unchanged.
 *
 * The mapped (options) path is NOT re-validated through Zod — `resolveOptions`
 * already applied defaults + the required-field checks; the regex/length rules in
 * the env schema only make sense for raw string env input.
 */
export function buildConfig(opts?: ResolvedOpenBucketOptions): Env {
  if (!opts) return loadEnv(process.env);
  return {
    // App-level (the host owns its process/listener/logger; sensible defaults).
    NODE_ENV: (process.env.NODE_ENV as Env['NODE_ENV']) || 'production',
    PORT: 9000,
    LOG_LEVEL: 'info',
    SHUTDOWN_DRAIN_MS: 30_000,

    DATA_DIR: opts.dataDir,
    JWT_SECRET: opts.admin?.jwtSecret ?? '',
    JWT_ACCESS_TTL_SECONDS: opts.admin?.jwtAccessTtl ?? 900,
    JWT_REFRESH_TTL_SECONDS: opts.admin?.jwtRefreshTtl ?? 604_800,
    ADMIN_USERNAME: opts.admin?.username ?? 'admin',
    ADMIN_PASSWORD_HASH: opts.admin?.passwordHash ?? '',
    ROOT_ACCESS_KEY_ID: opts.rootCredentials.accessKeyId,
    ROOT_SECRET_ACCESS_KEY: opts.rootCredentials.secretAccessKey,
    OPENBUCKET_ENDPOINT: opts.endpoint,
    OPENBUCKET_REGION: opts.region,
    OPENBUCKET_SSE_KEY: opts.sseKey,
    MAX_OBJECT_SIZE_MB: opts.limits.maxObjectSizeMb,
    MAX_MULTIPART_PARTS: opts.limits.maxMultipartParts,
    MULTIPART_TTL_HOURS: opts.limits.multipartTtlHours,
    // Usage analytics rollup (STORY-1102). Library hosts get the env-schema
    // defaults; the env-driven standalone path can tune them.
    USAGE_ROLLUP_INTERVAL_MS: 900_000,
    USAGE_RETENTION_DAYS: 90,
    // Durable admin audit log (STORY-1103). Library hosts get the env-schema
    // defaults; the env-driven standalone path can tune them.
    AUDIT_RETENTION_DAYS: 90,
    AUDIT_FLUSH_MS: 2_000,
    AUDIT_BUFFER_MAX: 10_000,
    // Hardening limits (TASK-2140/2141/2143/2144). Library hosts get the same
    // defaults as the env schema; they front OpenBucket with their own process
    // and can tune these via the env-driven standalone path if needed.
    DATA_DIR_MIN_FREE_BYTES: 100 * 1024 * 1024,
    STORAGE_QUOTA_BYTES: 0,
    STORAGE_QUOTA_OBJECTS: 0,
    MAX_CONCURRENT_MULTIPART_UPLOADS: 1_000,
    S3_THROTTLE_LIMIT: 1_000,
    S3_THROTTLE_TTL_MS: 60_000,
    RESTORE_MAX_TOTAL_BYTES: 100 * 1024 * 1024 * 1024,
    RESTORE_MAX_ENTRY_BYTES: 5 * 1024 * 1024 * 1024,
    RESTORE_MAX_ENTRIES: 1_000_000,
    RESTORE_MAX_MANIFEST_BYTES: 4 * 1024 * 1024,
    // Image transforms (STORY-0800). Library hosts get the same DoS-bounded
    // defaults as the env schema; the env-driven standalone path can tune them.
    IMAGE_TRANSFORM_ENABLED: true,
    MAX_TRANSFORM_DIMENSION: 4_096,
    MAX_TRANSFORM_INPUT_BYTES: 50 * 1024 * 1024,
    IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS: 24_000 * 24_000,
    IMAGE_TRANSFORM_CONCURRENCY: 4,
    DERIVATIVE_CACHE_MAX_BYTES: 5 * 1024 * 1024 * 1024,
    // Object-event webhooks (STORY-0801). Off unless the host passes a `webhooks`
    // block; the resolved defaults mirror the env schema. Mirrors OPENBUCKET_REGION
    // / MAX_OBJECT_SIZE_MB above (options → env-shaped source).
    WEBHOOK_URL: opts.webhooks?.url,
    WEBHOOK_SECRET: opts.webhooks?.secret,
    WEBHOOK_MAX_ATTEMPTS: opts.webhooks?.maxAttempts ?? 8,
    WEBHOOK_TIMEOUT_MS: opts.webhooks?.timeoutMs ?? 5_000,
    WEBHOOK_POLL_MS: opts.webhooks?.pollMs ?? 15_000,
    WEBHOOK_EVENTS:
      opts.webhooks?.events?.join(',') ??
      'object.created,object.deleted,multipart.completed',
    // Async replication (STORY-0900). Off unless the host passes a `replication`
    // block; resolved defaults mirror the env schema. `enabled` is derived from
    // the block's presence (the library caller never sets it explicitly).
    OB_REPLICATION_ENABLED: !!opts.replication,
    OB_REPLICATION_ENDPOINT: opts.replication?.endpoint,
    OB_REPLICATION_REGION: opts.replication?.region ?? 'us-east-1',
    OB_REPLICATION_BUCKET: opts.replication?.bucket,
    OB_REPLICATION_ACCESS_KEY_ID: opts.replication?.credentials.accessKeyId,
    OB_REPLICATION_SECRET_ACCESS_KEY: opts.replication?.credentials.secretAccessKey,
    OB_REPLICATION_FORCE_PATH_STYLE: opts.replication?.forcePathStyle ?? true,
    OB_REPLICATION_MAX_ATTEMPTS: opts.replication?.maxAttempts ?? 12,
    OB_REPLICATION_DRAIN_INTERVAL_MS: opts.replication?.drainIntervalMs ?? 5_000,
    OB_REPLICATION_BATCH_KEYS: opts.replication?.batchKeys ?? 50,
    OB_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES:
      opts.replication?.largeObjectThresholdBytes ?? 64 * 1024 * 1024,
    // Cold-object tiering (STORY-0901). Off by default; a library host enables it
    // via the env-driven standalone path. Defaults mirror the env schema.
    OPENBUCKET_TIER_ENABLED: false,
    OPENBUCKET_TIER_INLINE_MAX_BYTES: 256 * 1024 * 1024,
    OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS: 30_000,
    OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE: 8,
    OPENBUCKET_TIER_PRESIGN_TTL_SECONDS: 300,
    // Prometheus /metrics + OpenTelemetry (STORY-1202). Off by default; a library
    // host opts in via the `metrics` / `tracing` option blocks. `resolveOptions`
    // already defaulted the mode to 'off'.
    METRICS_MODE: opts.metrics?.mode ?? 'off',
    METRICS_TOKEN: opts.metrics?.token,
    OTEL_TRACING_ENABLED: opts.tracing?.enabled ?? false,
  };
}
