import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';
import { ObjectEncryptionState, ObjectLocation } from './types';

@Entity({ tableName: 'object_versions' })
@Index({ name: 'ix_versions_bucket_key_version', properties: ['bucket', 'key', 'versionId'] })
@Index({ name: 'ix_versions_bucket_key_created', properties: ['bucket', 'key', 'createdAt'] })
export class ObjectVersion {
  @ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @PrimaryKey({ type: 'text' })
  key!: string;

  @PrimaryKey({ type: 'string', length: 64 })
  versionId!: string; // uuid v7

  @Property({ type: 'bigint' })
  size = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  /** Hex SHA-256 of this version's plaintext bytes — read-time integrity (F1). */
  @Property({ type: 'string', length: 64, nullable: true })
  contentSha256?: string;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  /** SSE-S3 at-rest state for this version (STORY-0122); absent ⇒ plaintext. */
  @Property({ type: 'json', nullable: true })
  encryption?: ObjectEncryptionState;

  @Property({ type: 'boolean', default: false })
  isDeleteMarker = false;

  // -------- cold-object tiering (STORY-0901) --------------------------------
  // Mirror the object-row location columns so a tiered noncurrent version is
  // tracked too. Defaults to `local` (back-compat).
  @Property({ type: 'string', default: ObjectLocation.Local })
  location: ObjectLocation = ObjectLocation.Local;

  /** Remote object key when this version is tiered (key-codec encoded). Null when LOCAL. */
  @Property({ type: 'text', nullable: true })
  remoteKey?: string;

  @Property({ type: 'datetime', nullable: true })
  tieredAt?: Date;

  @Property({ type: 'datetime', nullable: true })
  lastAccessedAt?: Date;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
