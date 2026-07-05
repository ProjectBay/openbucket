import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * Thin typed wrapper around `ConfigService<Env, true>` so the codebase
 * consumes typed getters instead of string lookups. See WHITEPAPER §1.7.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly raw: ConfigService<Env, true>) {}

  get nodeEnv(): Env['NODE_ENV'] { return this.raw.get('NODE_ENV', { infer: true }); }
  get port(): number { return this.raw.get('PORT', { infer: true }); }
  get logLevel(): Env['LOG_LEVEL'] { return this.raw.get('LOG_LEVEL', { infer: true }); }
  get dataDir(): string { return this.raw.get('DATA_DIR', { infer: true }); }
  get jwtSecret(): string { return this.raw.get('JWT_SECRET', { infer: true }); }
  get jwtAccessTtl(): number { return this.raw.get('JWT_ACCESS_TTL_SECONDS', { infer: true }); }
  get jwtRefreshTtl(): number { return this.raw.get('JWT_REFRESH_TTL_SECONDS', { infer: true }); }
  get adminUsername(): string { return this.raw.get('ADMIN_USERNAME', { infer: true }); }
  get adminPasswordHash(): string { return this.raw.get('ADMIN_PASSWORD_HASH', { infer: true }); }
  get rootAccessKeyId(): string { return this.raw.get('ROOT_ACCESS_KEY_ID', { infer: true }); }
  get rootSecretAccessKey(): string { return this.raw.get('ROOT_SECRET_ACCESS_KEY', { infer: true }); }
  get keyEncryptionSecret(): string | undefined { return this.raw.get('KEY_ENCRYPTION_SECRET', { infer: true }); }
  get endpoint(): string | undefined { return this.raw.get('OPENBUCKET_ENDPOINT', { infer: true }); }
  get region(): string { return this.raw.get('OPENBUCKET_REGION', { infer: true }); }
  get sseKey(): string | undefined { return this.raw.get('OPENBUCKET_SSE_KEY', { infer: true }); }
  get maxObjectSizeMb(): number { return this.raw.get('MAX_OBJECT_SIZE_MB', { infer: true }); }
  get maxMultipartParts(): number { return this.raw.get('MAX_MULTIPART_PARTS', { infer: true }); }
  get multipartTtlHours(): number { return this.raw.get('MULTIPART_TTL_HOURS', { infer: true }); }
  // --- usage analytics rollup (STORY-1102) ---
  get usageRollupIntervalMs(): number { return this.raw.get('USAGE_ROLLUP_INTERVAL_MS', { infer: true }); }
  get usageRetentionDays(): number { return this.raw.get('USAGE_RETENTION_DAYS', { infer: true }); }
  // --- durable admin audit log (STORY-1103) ---
  get auditRetentionDays(): number { return this.raw.get('AUDIT_RETENTION_DAYS', { infer: true }); }
  get auditFlushMs(): number { return this.raw.get('AUDIT_FLUSH_MS', { infer: true }); }
  get auditBufferMax(): number { return this.raw.get('AUDIT_BUFFER_MAX', { infer: true }); }
  get dataDirMinFreeBytes(): number { return this.raw.get('DATA_DIR_MIN_FREE_BYTES', { infer: true }); }
  get storageQuotaBytes(): number { return this.raw.get('STORAGE_QUOTA_BYTES', { infer: true }); }
  get storageQuotaObjects(): number { return this.raw.get('STORAGE_QUOTA_OBJECTS', { infer: true }); }
  get maxConcurrentMultipartUploads(): number { return this.raw.get('MAX_CONCURRENT_MULTIPART_UPLOADS', { infer: true }); }
  get s3ThrottleLimit(): number { return this.raw.get('S3_THROTTLE_LIMIT', { infer: true }); }
  get s3ThrottleTtlMs(): number { return this.raw.get('S3_THROTTLE_TTL_MS', { infer: true }); }
  get restoreMaxTotalBytes(): number { return this.raw.get('RESTORE_MAX_TOTAL_BYTES', { infer: true }); }
  get restoreMaxEntryBytes(): number { return this.raw.get('RESTORE_MAX_ENTRY_BYTES', { infer: true }); }
  get restoreMaxEntries(): number { return this.raw.get('RESTORE_MAX_ENTRIES', { infer: true }); }
  get restoreMaxManifestBytes(): number { return this.raw.get('RESTORE_MAX_MANIFEST_BYTES', { infer: true }); }
  get shutdownDrainMs(): number { return this.raw.get('SHUTDOWN_DRAIN_MS', { infer: true }); }
  // --- image transforms (STORY-0800) ---
  get imageTransformEnabled(): boolean { return this.raw.get('IMAGE_TRANSFORM_ENABLED', { infer: true }); }
  get maxTransformDimension(): number { return this.raw.get('MAX_TRANSFORM_DIMENSION', { infer: true }); }
  get maxTransformInputBytes(): number { return this.raw.get('MAX_TRANSFORM_INPUT_BYTES', { infer: true }); }
  get transformLimitInputPixels(): number { return this.raw.get('IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS', { infer: true }); }
  get imageTransformConcurrency(): number { return this.raw.get('IMAGE_TRANSFORM_CONCURRENCY', { infer: true }); }
  get derivativeCacheMaxBytes(): number { return this.raw.get('DERIVATIVE_CACHE_MAX_BYTES', { infer: true }); }
  // --- object-event webhooks (STORY-0801) ---
  get webhookUrl(): string | undefined { return this.raw.get('WEBHOOK_URL', { infer: true }); }
  /** True when a webhook URL is configured; gates the outbox + delivery runner. */
  get webhooksEnabled(): boolean { return !!this.webhookUrl; }
  get webhookSecret(): string { return this.raw.get('WEBHOOK_SECRET', { infer: true }) ?? ''; }
  get webhookMaxAttempts(): number { return this.raw.get('WEBHOOK_MAX_ATTEMPTS', { infer: true }); }
  get webhookTimeoutMs(): number { return this.raw.get('WEBHOOK_TIMEOUT_MS', { infer: true }); }
  get webhookPollMs(): number { return this.raw.get('WEBHOOK_POLL_MS', { infer: true }); }
  /** The CSV event filter parsed to a trimmed, non-empty list. */
  get webhookEvents(): string[] {
    return this.raw
      .get('WEBHOOK_EVENTS', { infer: true })
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // --- async replication to external S3 target (STORY-0900) ---
  get replicationEnabled(): boolean { return this.raw.get('OB_REPLICATION_ENABLED', { infer: true }); }
  get replicationEndpoint(): string | undefined { return this.raw.get('OB_REPLICATION_ENDPOINT', { infer: true }); }
  get replicationRegion(): string { return this.raw.get('OB_REPLICATION_REGION', { infer: true }); }
  get replicationBucket(): string | undefined { return this.raw.get('OB_REPLICATION_BUCKET', { infer: true }); }
  get replicationAccessKeyId(): string | undefined { return this.raw.get('OB_REPLICATION_ACCESS_KEY_ID', { infer: true }); }
  get replicationSecretAccessKey(): string | undefined { return this.raw.get('OB_REPLICATION_SECRET_ACCESS_KEY', { infer: true }); }
  get replicationForcePathStyle(): boolean { return this.raw.get('OB_REPLICATION_FORCE_PATH_STYLE', { infer: true }); }
  get replicationMaxAttempts(): number { return this.raw.get('OB_REPLICATION_MAX_ATTEMPTS', { infer: true }); }
  get replicationDrainIntervalMs(): number { return this.raw.get('OB_REPLICATION_DRAIN_INTERVAL_MS', { infer: true }); }
  get replicationBatchKeys(): number { return this.raw.get('OB_REPLICATION_BATCH_KEYS', { infer: true }); }
  get replicationLargeObjectThresholdBytes(): number { return this.raw.get('OB_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES', { infer: true }); }

  // --- Prometheus /metrics + OpenTelemetry (STORY-1202) ---
  get metricsMode(): Env['METRICS_MODE'] { return this.raw.get('METRICS_MODE', { infer: true }); }
  get metricsToken(): string | undefined { return this.raw.get('METRICS_TOKEN', { infer: true }); }
  get tracingEnabled(): boolean { return this.raw.get('OTEL_TRACING_ENABLED', { infer: true }); }

  // --- cold-object tiering (STORY-0901) ---
  get tierEnabled(): boolean { return this.raw.get('OPENBUCKET_TIER_ENABLED', { infer: true }); }
  get tierInlineMaxBytes(): number { return this.raw.get('OPENBUCKET_TIER_INLINE_MAX_BYTES', { infer: true }); }
  get tierReadThroughTimeoutMs(): number { return this.raw.get('OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS', { infer: true }); }
  get tierMaxConcurrentRehydrate(): number { return this.raw.get('OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE', { infer: true }); }
  get tierPresignTtlSeconds(): number { return this.raw.get('OPENBUCKET_TIER_PRESIGN_TTL_SECONDS', { infer: true }); }
}
