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

/**
 * Where an object's bytes physically live (STORY-0901, cold-object tiering).
 * Defaults to `Local` so every pre-tiering row is served exactly as before —
 * the feature is inert until a transition rule + remote target are configured.
 */
export enum ObjectLocation {
  /** Blob is on the local FS (default, back-compat). */
  Local = 'local',
  /** Blob offloaded to the STORY-0900 remote; the row is a metadata stub. */
  Remote = 'remote',
  /** Read-through rehydration in progress (single-flight marker). */
  Rehydrating = 'rehydrating',
}

/** The storage classes a lifecycle transition may move an object to. */
export type TransitionStorageClass = 'STANDARD_IA' | 'GLACIER' | 'DEEP_ARCHIVE';

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
  /**
   * Cold-object tiering transition (STORY-0901). Independent of the expiration
   * fields — a rule may carry both. `transitionDays` is the age (in days, since
   * last access) after which a current, local object is offloaded to the remote
   * target; `transitionStorageClass` is the class recorded on the tiered stub.
   */
  transitionDays?: number;
  transitionStorageClass?: TransitionStorageClass;
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

/**
 * Admin authorization role (EPIC-11, STORY-1002). `admin` is a full operator
 * (every state-changing admin action); `readonly` may authenticate and read but
 * is 403'd by `RolesGuard` on mutating admin routes (bar the self-service
 * allowlist). Lives here — not in `admin/` — so both the persistence layer and
 * the admin controllers/DTOs can import it without a layering inversion.
 */
export type AdminRole = 'admin' | 'readonly';

/** The admin roles as a tuple, for `z.enum(ADMIN_ROLES)` DTO validation. */
export const ADMIN_ROLES = ['admin', 'readonly'] as const;
