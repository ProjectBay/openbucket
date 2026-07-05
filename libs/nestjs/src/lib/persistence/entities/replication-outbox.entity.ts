import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';
import { ReplicationOutboxRepository } from '../repositories/replication-outbox.repository';

/** One-way local→remote replication op. Only the current visible state is
 *  reflected remotely (no per-version history in v1). */
export type ReplicationOp = 'PUT' | 'DELETE';

/** Lifecycle of an outbox row. `done` rows are deleted immediately after a
 *  successful send; `failed` is the dead-letter terminal state. */
export type ReplicationOutboxStatus = 'pending' | 'failed' | 'done';

/**
 * A durable replication intent — the transactional outbox for async replication
 * to an external S3-compatible target (STORY-0900). Exactly one row is inserted
 * per object mutation (PUT/DELETE) INSIDE the same MikroORM transaction as the
 * object-metadata commit (`ReplicationOutboxService.enqueue`), so the intent is
 * committed atomically with the write and can never be lost or orphaned by a
 * rollback. The `ReplicationWorkerRunner` drains it, preserving per-key order.
 *
 * `seq` is a process-monotonic ordering key (assigned at enqueue, strictly
 * increasing; the writer's per-`(bucket,key)` mutex guarantees same-key intents
 * are enqueued — and so ordered — in write order). The worker coalesces a key's
 * pending chain (last-writer-wins) using `seq ASC`.
 *
 * No secret is stored here — only the object's public metadata (etag/size/
 * contentType). The bytes are read fresh from the local store at drain time.
 */
@Entity({ tableName: 'replication_outbox', repository: () => ReplicationOutboxRepository })
@Index({ name: 'ix_repl_outbox_due', properties: ['status', 'nextAttemptAt'] })
@Index({ name: 'ix_repl_outbox_key', properties: ['bucket', 'key', 'seq'] })
export class ReplicationOutbox {
  /** uuidv7 — service-generated, time-sortable. */
  @PrimaryKey({ type: 'string', length: 64 })
  id!: string;

  /** Global FIFO / per-key order (process-monotonic, assigned at enqueue). */
  @Property({ type: 'bigint' })
  seq!: bigint;

  @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
  bucket!: Bucket;

  @Property({ type: 'text' })
  key!: string;

  @Property({ type: 'string', length: 8 })
  op!: ReplicationOp;

  /** `currentVersionId` at enqueue (diagnostic / superseded-detection aid). */
  @Property({ type: 'string', nullable: true })
  versionId?: string;

  @Property({ type: 'string', length: 64, nullable: true })
  etag?: string;

  @Property({ type: 'bigint', nullable: true })
  size?: bigint;

  @Property({ type: 'string', length: 255, nullable: true })
  contentType?: string;

  @Property({ type: 'string', length: 16, default: 'pending' })
  status: ReplicationOutboxStatus = 'pending';

  @Property({ type: 'integer', default: 0 })
  attempts = 0;

  @Property({ type: 'datetime' })
  nextAttemptAt: Date = new Date();

  @Property({ type: 'text', nullable: true })
  lastError?: string;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
