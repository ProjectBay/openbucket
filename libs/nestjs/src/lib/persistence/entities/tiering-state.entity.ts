import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';

/**
 * Per-rule resume cursor for the cold-object tiering sweep (STORY-0901). Mirrors
 * {@link LifecycleState} verbatim (composite PK `(bucket, ruleId)`,
 * `lastKeyProcessed`, `lastSweepAt`) under its own `tiering_state` table so the
 * tiering sweep and the lifecycle sweep keep independent cursors for the same
 * bucket. The sweep runner (TASK-2711) reuses the same cursor protocol.
 */
@Entity({ tableName: 'tiering_state' })
export class TieringState {
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
