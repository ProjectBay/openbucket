import { EntityRepository } from '@mikro-orm/libsql';

import { ReplicationOutbox } from '../entities/replication-outbox.entity';

/**
 * Replication-outbox persistence (STORY-0900). The bounded queries the
 * `ReplicationWorkerRunner` drives every tick:
 *  - `dueKeys` — the next batch of distinct `(bucket, key)` pairs that have a
 *    due `pending` intent, ordered by their earliest `seq` so the oldest work
 *    drains first; `LIMIT`-bounded so a backlog drains in fixed-size chunks
 *    (CWE-770) and the `ix_repl_outbox_due` index keeps it O(log n).
 *  - `pendingForKey` — the full pending chain for one key, `seq ASC`, which the
 *    worker coalesces (last-writer-wins).
 *  - `deleteDoneForKey` — drop the coalesced/acted rows once the send succeeds
 *    (retention: keep the table small).
 *  - `countByStatus` — feeds STORY-0902 metrics.
 */
export class ReplicationOutboxRepository extends EntityRepository<ReplicationOutbox> {
  /**
   * Distinct `(bucket, key)` keys with at least one due `pending` intent
   * (`next_attempt_at <= now`), ordered by the key's earliest pending `seq`
   * (oldest first), capped at `limit` keys. A raw query-builder GROUP BY is used
   * so we return one row per key (not one per intent) and bound per-tick work.
   */
  async dueKeys(now: Date, limit: number): Promise<Array<{ bucket: string; key: string }>> {
    const rows = (await this.getEntityManager()
      .createQueryBuilder(ReplicationOutbox, 'o')
      .select(['o.bucket_name as bucket', 'o.key as key'])
      .where({ status: 'pending', nextAttemptAt: { $lte: now } })
      .groupBy(['o.bucket_name', 'o.key'])
      .orderBy({ [`min(o.seq)`]: 'asc' })
      .limit(limit)
      .execute('all')) as Array<{ bucket: string; key: string }>;
    return rows.map((r) => ({ bucket: r.bucket, key: r.key }));
  }

  /** All `pending` intents for a key, oldest-first (`seq ASC`) — the chain the
   *  worker coalesces. */
  async pendingForKey(bucket: string, key: string): Promise<ReplicationOutbox[]> {
    return this.find(
      { bucket: bucket as unknown as ReplicationOutbox['bucket'], key, status: 'pending' },
      { orderBy: { seq: 'asc' } },
    );
  }

  /** Delete every `done` row for a key (retention — called after a successful
   *  send coalesces the chain). Returns the number of rows removed. */
  async deleteDoneForKey(bucket: string, key: string): Promise<number> {
    return this.getEntityManager().nativeDelete(ReplicationOutbox, {
      bucket: bucket as unknown as ReplicationOutbox['bucket'],
      key,
      status: 'done',
    });
  }

  /** Row counts grouped by status — `{ pending, failed, done }`. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = (await this.getEntityManager()
      .createQueryBuilder(ReplicationOutbox, 'o')
      .select(['o.status as status', 'count(*) as cnt'])
      .groupBy('o.status')
      .execute('all')) as Array<{ status: string; cnt: number | string }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.cnt);
    return out;
  }
}
