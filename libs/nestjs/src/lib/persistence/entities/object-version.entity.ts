import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';
import { ObjectEncryptionState } from './types';

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

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  /** SSE-S3 at-rest state for this version (STORY-0122); absent ⇒ plaintext. */
  @Property({ type: 'json', nullable: true })
  encryption?: ObjectEncryptionState;

  @Property({ type: 'boolean', default: false })
  isDeleteMarker = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
