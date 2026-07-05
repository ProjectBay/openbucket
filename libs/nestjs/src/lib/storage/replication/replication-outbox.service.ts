import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { v7 as uuidv7 } from 'uuid';

import { Bucket, ReplicationOutbox } from '../../persistence/index';
import { REPLICATION_CONFIG, type ReplicationConfig } from './replication-config';

/**
 * Process-monotonic sequence generator. `seq` only needs a total order
 * consistent with insert order; the writer's per-`(bucket,key)` mutex guarantees
 * same-key intents are enqueued (and so ordered) in write order, and cross-key
 * order is irrelevant to correctness (keys are independent). Deriving `seq` from
 * the wall clock (× 1000, +1 on collision) keeps it strictly increasing WITHIN a
 * process and monotonic ACROSS a restart (time only moves forward), which is all
 * the single-process drain worker requires — no SQLite autoincrement needed.
 * See STORY-0900 spike (TASK-2704) findings.
 */
let lastSeq = 0n;
export function nextReplicationSeq(nowMs: number = Date.now()): bigint {
  const candidate = BigInt(nowMs) * 1000n;
  lastSeq = candidate > lastSeq ? candidate : lastSeq + 1n;
  return lastSeq;
}

export interface ReplicationIntent {
  bucket: Bucket;
  key: string;
  op: 'PUT' | 'DELETE';
  versionId?: string;
  etag?: string;
  size?: bigint;
  contentType?: string;
}

/**
 * The enqueue seam of the transactional outbox (STORY-0900). `enqueue` joins the
 * CALLER's open `EntityManager` (it does NOT fork), so the intent row is flushed
 * by the caller's `em.commit()` — committed atomically with the object-metadata
 * write and rolled back with it if the write aborts. Synchronous, no I/O: it adds
 * at most one INSERT to the hot write path, and nothing at all when disabled.
 *
 * The worker coalesces multiple intents per key (last-writer-wins), so this seam
 * never dedupes — it always appends. A PUT that overwrites a key twice enqueues
 * two rows; the worker sends only the latest.
 */
@Injectable()
export class ReplicationOutboxService {
  constructor(@Inject(REPLICATION_CONFIG) private readonly config: ReplicationConfig) {}

  /** True when replication is configured — lets callers skip building an intent. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Persist a replication intent on the caller's `em` (pre-commit). No-op when
   * replication is disabled so the outbox stays empty and the write path pays
   * ~zero for local-only deployments.
   */
  enqueue(em: EntityManager, intent: ReplicationIntent): void {
    if (!this.config.enabled) return;
    const now = new Date();
    em.persist(
      em.create(ReplicationOutbox, {
        id: uuidv7(),
        seq: nextReplicationSeq(now.getTime()),
        bucket: intent.bucket,
        key: intent.key,
        op: intent.op,
        versionId: intent.versionId,
        etag: intent.etag,
        size: intent.size,
        contentType: intent.contentType,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
}
