import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';
import { ObjectRepository } from '../repositories/object.repository';
import { ObjectEncryptionState, ObjectLockObjectState, StorageClass, TagSet } from './types';

// Lazy `repository: () => …` — see bucket.entity.ts for the rationale.
@Entity({ tableName: 'objects', repository: () => ObjectRepository })
@Unique({ name: 'uq_objects_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_objects_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_objects_bucket_softdeleted', properties: ['bucket', 'softDeleted'] })
export class ObjectEntity {
  // Surrogate PK so the FK target is stable across renames. Composite
  // (bucket, key) is enforced by the unique constraint above.
  @PrimaryKey({ type: 'string' })
  id!: string; // uuid v7 — generated in service layer

  @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @Property({ type: 'text' })
  key!: string;

  /** versionId of the version currently reachable via the path-mirror filename. */
  @Property({ type: 'string', nullable: true })
  currentVersionId?: string;

  @Property({ type: 'bigint' })
  size = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'json', nullable: true })
  tagging?: TagSet;

  @Property({ type: 'json', nullable: true })
  lock?: ObjectLockObjectState;

  /** SSE-S3 at-rest encryption state (STORY-0122); absent ⇒ plaintext blob. */
  @Property({ type: 'json', nullable: true })
  encryption?: ObjectEncryptionState;

  @Property({ type: 'string', default: StorageClass.Standard })
  storageClass: StorageClass = StorageClass.Standard;

  @Property({ type: 'boolean', default: false })
  softDeleted = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  modifiedAt: Date = new Date();
}
