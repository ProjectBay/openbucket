export enum VersioningState {
  Disabled = 'disabled',
  Enabled = 'enabled',
  Suspended = 'suspended',
}

export enum ObjectLockMode {
  Off = 'off',
  Governance = 'governance',
  Compliance = 'compliance',
}

export enum StorageClass {
  Standard = 'STANDARD',
  ReducedRedundancy = 'REDUCED_REDUNDANCY',
  StandardIA = 'STANDARD_IA',
  Glacier = 'GLACIER',
  DeepArchive = 'DEEP_ARCHIVE',
}

export interface ObjectLockBucketConfig {
  enabled: boolean;
  mode?: ObjectLockMode;
  defaultRetentionDays?: number;
}

export interface ObjectLockObjectState {
  mode: ObjectLockMode;
  retainUntil?: string; // ISO-8601
  legalHold?: boolean;
}

export interface EncryptionConfig {
  algorithm: 'AES256' | 'aws:kms' | null;
  kmsKeyId?: string;
}

/**
 * Per-object SSE-S3 at-rest encryption state (STORY-0122). Present only when the
 * object was written to an SSE-enabled bucket; absent ⇒ the blob is plaintext.
 * `iv` is the base64 AES-256-CTR initial counter for this object.
 */
export interface ObjectEncryptionState {
  algorithm: 'AES256';
  iv: string;
}

export interface CorsRule {
  id?: string;
  allowedOrigins: string[];
  allowedMethods: ('GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD')[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface LifecycleRule {
  id: string;
  status: 'Enabled' | 'Disabled';
  prefix?: string;
  filter?: { tag?: { key: string; value: string }; sizeGreaterThan?: number; sizeLessThan?: number };
  expirationDays?: number;
  expiredObjectDeleteMarker?: boolean;
  noncurrentVersionExpirationDays?: number;
  abortIncompleteMultipartUploadDays?: number;
}

export interface PolicyDocument {
  Version: '2012-10-17';
  Statement: Array<{
    Sid?: string;
    Effect: 'Allow' | 'Deny';
    Principal: '*' | { AWS: string | string[] };
    Action: string | string[];
    Resource: string | string[];
    Condition?: Record<string, Record<string, string | string[]>>;
  }>;
}

export type TagSet = Record<string, string>;
