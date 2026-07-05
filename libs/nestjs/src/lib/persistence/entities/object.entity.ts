import {
  Collection,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';

import { Bucket } from './bucket.entity';
import { ObjectTag } from './object-tag.entity';
import { ObjectRepository } from '../repositories/object.repository';
import {
  ObjectEncryptionState,
  ObjectLocation,
  ObjectLockObjectState,
  StorageClass,
  TagSet,
} from './types';

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

  /**
   * Hex SHA-256 of the object's PLAINTEXT bytes (whole object). Unlike `etag`
   * (md5-of-md5s for multipart), this is a single strong digest over the entire
   * content, so getObject can verify integrity on read for ANY object —
   * single-part or multipart — the read-time integrity gate (F1). Nullable:
   * objects written before this column existed are simply not read-verified.
   */
  @Property({ type: 'string', length: 64, nullable: true })
  contentSha256?: string;

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

  // -------- cold-object tiering (STORY-0901) --------------------------------
  // Where the object's bytes physically live. Defaults to `local` so every
  // pre-tiering row is served exactly as today; only a transition sweep flips it.
  @Property({ type: 'string', default: ObjectLocation.Local })
  location: ObjectLocation = ObjectLocation.Local;

  /** Remote object key when tiered (key-codec encoded, bucket-scoped). Null when LOCAL. */
  @Property({ type: 'text', nullable: true })
  remoteKey?: string;

  @Property({ type: 'datetime', nullable: true })
  tieredAt?: Date;

  /** Read/HEAD access clock for cold selection; nullable ⇒ fall back to modifiedAt. */
  @Index({ name: 'ix_objects_lastaccessed' })
  @Property({ type: 'datetime', nullable: true })
  lastAccessedAt?: Date;

  @Property({ type: 'boolean', default: false })
  softDeleted = false;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  modifiedAt: Date = new Date();

  /**
   * Derived tag-index rows (STORY-1101, TASK-3312). Inverse side of
   * {@link ObjectTag.object}; joined by cross-bucket search when a `tagKey`/
   * `tagValue` filter is present. The `objects.tagging` JSON column above remains
   * the source of truth — this collection is a rebuildable index.
   */
  @OneToMany(() => ObjectTag, (t) => t.object)
  tags = new Collection<ObjectTag>(this);
}
