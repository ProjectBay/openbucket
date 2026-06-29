import { Collection, Entity, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';

import { ObjectEntity } from './object.entity';
import { BucketRepository } from '../repositories/bucket.repository';
import {
  CorsRule,
  EncryptionConfig,
  LifecycleRule,
  ObjectLockBucketConfig,
  PolicyDocument,
  TagSet,
  VersioningState,
} from './types';

// `repository: () => …` is lazy so the circular import (entity ↔ repo) resolves
// — neither value is evaluated at decoration time. MikroORM-Nest's
// `MikroOrmModule.forFeature` then auto-provides `BucketRepository` at the
// `getRepositoryToken(Bucket)` token; the persistence module also exposes it
// under the class token for class-based injection.
@Entity({ tableName: 'buckets', repository: () => BucketRepository })
export class Bucket {
  @PrimaryKey({ type: 'string', length: 63 })
  name!: string;

  @Property({ type: 'string', length: 32, default: 'us-east-1' })
  region = 'us-east-1';

  @Property({ type: 'string', default: VersioningState.Disabled })
  versioning: VersioningState = VersioningState.Disabled;

  @Property({ type: 'json', nullable: true })
  objectLock?: ObjectLockBucketConfig;

  @Property({ type: 'json', nullable: true })
  encryption?: EncryptionConfig;

  @Property({ type: 'json', nullable: true })
  cors?: CorsRule[];

  @Property({ type: 'json', nullable: true })
  lifecycle?: LifecycleRule[];

  @Property({ type: 'json', nullable: true })
  tagging?: TagSet;

  @Property({ type: 'json', nullable: true })
  policy?: PolicyDocument;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  modifiedAt: Date = new Date();

  @OneToMany(() => ObjectEntity, (o) => o.bucket)
  objects = new Collection<ObjectEntity>(this);
}
