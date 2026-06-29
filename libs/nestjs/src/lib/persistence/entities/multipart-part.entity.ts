import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { MultipartUpload } from './multipart-upload.entity';

@Entity({ tableName: 'multipart_parts' })
@Index({ name: 'ix_mpp_upload_part', properties: ['upload', 'partNumber'] })
export class MultipartPart {
  @ManyToOne(() => MultipartUpload, { primary: true, fieldName: 'upload_id', deleteRule: 'cascade' })
  upload!: MultipartUpload;

  @PrimaryKey({ type: 'integer' })
  partNumber!: number; // 1..10000 per S3 contract

  @Property({ type: 'bigint' })
  size = 0n;

  @Property({ type: 'string', length: 64 })
  etag!: string;

  /** Optional sha256 from x-amz-checksum-* trailers. */
  @Property({ type: 'string', length: 128, nullable: true })
  checksumSha256?: string;

  @Property({ type: 'datetime' })
  writtenAt: Date = new Date();
}
