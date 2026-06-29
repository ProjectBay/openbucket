import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';

@Entity({ tableName: 'lifecycle_state' })
export class LifecycleState {
  @ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @PrimaryKey({ type: 'string', length: 64 })
  ruleId!: string;

  @Property({ type: 'datetime', nullable: true })
  lastSweepAt?: Date;

  /** Resume cursor — the last key fully processed during the previous tick. */
  @Property({ type: 'text', nullable: true })
  lastKeyProcessed?: string;
}
