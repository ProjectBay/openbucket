import { Collection, Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';
import { MultipartPart } from './multipart-part.entity';
import { EncryptionConfig } from './types';

@Entity({ tableName: 'multipart_uploads' })
@Index({ name: 'ix_mpu_bucket_key', properties: ['bucket', 'key'] })
@Index({ name: 'ix_mpu_initiated', properties: ['initiatedAt'] })
export class MultipartUpload {
  @PrimaryKey({ type: 'string', length: 64 })
  uploadId!: string; // uuid v7

  @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @Property({ type: 'text' })
  key!: string;

  @Property({ type: 'string', length: 128, default: 'root' })
  initiator = 'root';

  @Property({ type: 'json', nullable: true })
  encryption?: EncryptionConfig;

  @Property({ type: 'string', length: 255, default: 'application/octet-stream' })
  contentType = 'application/octet-stream';

  @Property({ type: 'json', nullable: true })
  userMetadata?: Record<string, string>;

  @Property({ type: 'datetime' })
  initiatedAt: Date = new Date();

  @OneToMany(() => MultipartPart, (p) => p.upload, { orphanRemoval: true })
  parts = new Collection<MultipartPart>(this);
}
