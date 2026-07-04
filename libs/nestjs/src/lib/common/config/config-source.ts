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
  };
}
