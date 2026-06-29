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
  };
}
