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
  get endpoint(): string | undefined { return this.raw.get('OPENBUCKET_ENDPOINT', { infer: true }); }
  get region(): string { return this.raw.get('OPENBUCKET_REGION', { infer: true }); }
  get sseKey(): string | undefined { return this.raw.get('OPENBUCKET_SSE_KEY', { infer: true }); }
  get maxObjectSizeMb(): number { return this.raw.get('MAX_OBJECT_SIZE_MB', { infer: true }); }
  get maxMultipartParts(): number { return this.raw.get('MAX_MULTIPART_PARTS', { infer: true }); }
  get multipartTtlHours(): number { return this.raw.get('MULTIPART_TTL_HOURS', { infer: true }); }
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
}
