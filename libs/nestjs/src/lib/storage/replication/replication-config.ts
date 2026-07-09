import { Logger } from '@nestjs/common';

import { AppConfigService } from '../../common/config/app-config.service';
import { validateReplicationEndpoint } from '../../common/config/env.schema';

/**
 * The single resolved replication shape both config sources (standalone env +
 * library `forRoot` options) funnel through. When `enabled` is `false` every
 * other field is meaningless and no `S3Client` is ever constructed, so the rest
 * of STORY-0900 short-circuits at zero cost.
 */
export interface ReplicationConfig {
  enabled: boolean;
  /** https://… (R2/B2/MinIO) — omit for real AWS S3. */
  endpoint?: string;
  /** Target region. Default `us-east-1`. */
  region: string;
  /** Remote target bucket. */
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true for MinIO/other S3-compat; false for AWS. */
  forcePathStyle: boolean;
  /** Dead-letter cap. Default 12. */
  maxAttempts: number;
  /** Drain tick interval (ms). Default 5000. */
  drainIntervalMs: number;
  /** Distinct keys drained per tick. Default 50. */
  batchKeys: number;
  /** Switch to lib-storage multipart above this size. Default 64 MiB. */
  largeObjectThresholdBytes: number;
}

/** DI token carrying the fully-resolved {@link ReplicationConfig}. */
export const REPLICATION_CONFIG = Symbol('REPLICATION_CONFIG');

/** A disabled config — no target, no client. */
const DISABLED: ReplicationConfig = {
  enabled: false,
  region: 'us-east-1',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: true,
  maxAttempts: 12,
  drainIntervalMs: 5_000,
  batchKeys: 50,
  largeObjectThresholdBytes: 64 * 1024 * 1024,
};

/**
 * Resolve the replication config from `AppConfigService` (both the env and the
 * options source already funnel through it). Returns `{ enabled: false }` when
 * replication is unset. Logs a boot-time WARNING for a plaintext `http://`
 * endpoint (the worker sends object PLAINTEXT — an http endpoint leaks contents)
 * but does not hard-fail (MinIO on a trusted LAN is a legitimate dev case). The
 * resolved config is NEVER logged — `secretAccessKey` lives only in the returned
 * object and, later, the S3Client credentials closure.
 */
export function resolveReplicationConfig(config: AppConfigService): ReplicationConfig {
  if (!config.replicationEnabled) return { ...DISABLED };

  const endpoint = config.replicationEndpoint;
  if (endpoint) {
    const { insecure } = validateReplicationEndpoint(endpoint);
    if (insecure) {
      new Logger('ReplicationConfig').warn(
        `OPENBUCKET_REPLICATION_ENDPOINT uses plaintext http:// — replicated object bytes ` +
          `(decrypted plaintext) will traverse the network unencrypted. Use https:// ` +
          `unless the target is on a trusted LAN (e.g. MinIO).`,
      );
    }
  }

  return {
    enabled: true,
    endpoint,
    region: config.replicationRegion,
    bucket: config.replicationBucket ?? '',
    accessKeyId: config.replicationAccessKeyId ?? '',
    secretAccessKey: config.replicationSecretAccessKey ?? '',
    forcePathStyle: config.replicationForcePathStyle,
    maxAttempts: config.replicationMaxAttempts,
    drainIntervalMs: config.replicationDrainIntervalMs,
    batchKeys: config.replicationBatchKeys,
    largeObjectThresholdBytes: config.replicationLargeObjectThresholdBytes,
  };
}
