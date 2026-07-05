import { Inject, Injectable } from '@nestjs/common';
import { raw } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { Clock } from '../../common/clock/clock';
import { ReplicationOutbox } from '../../persistence/entities/replication-outbox.entity';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import {
  REPLICATION_CONFIG,
  type ReplicationConfig,
} from '../../storage/replication/replication-config';

/** Bounded length of a surfaced `lastError.message` (defence in depth — the
 *  outbox column is already truncated at write time). */
const LAST_ERROR_MAX = 500;

/** Per-bucket replication depth + lag. */
export interface BucketReplicationStatus {
  bucket: string;
  pendingCount: number;
  inflightCount: number;
  failedCount: number;
  /** Age (ms) of the oldest pending intent for this bucket; null when none. */
  oldestPendingAgeMs: number | null;
}

/** Newest outbox failure — projected to the row's OWN coordinates only (never
 *  any remote endpoint/credential from the target config). */
export interface ReplicationLastError {
  message: string;
  at: string;
  bucket?: string;
  key?: string;
}

/** Instance-wide replication status read model. */
export interface ReplicationStatus {
  enabled: boolean;
  pendingCount: number;
  inflightCount: number;
  failedCount: number;
  oldestPendingAgeMs: number | null;
  lastError: ReplicationLastError | null;
  perBucket: BucketReplicationStatus[];
}

/** Raw aggregate row shape returned by the GROUP-BY query. */
interface AggregateRow {
  bucket: string;
  status: string;
  cnt: number | string;
  retrying: number | string;
  oldest: string | number | null;
}

/**
 * Operator-facing replication read model (STORY-0902). Aggregates the durable
 * `replication_outbox` (STORY-0900) into pending/inflight/failed depth,
 * replication lag (age of the oldest pending intent), the last error and a
 * per-bucket breakdown. PURE read: SQL `COUNT(*) … GROUP BY status, bucket`
 * aggregates — it NEVER materialises the (potentially large) outbox — and makes
 * no remote calls.
 *
 * `inflightCount` = pending intents already attempted at least once (being
 * retried with backoff); `pendingCount` = fresh, not-yet-attempted intents.
 * When no target is configured every counter is zero and `enabled` is false —
 * the endpoint still returns 200, never throws.
 */
@Injectable()
export class ReplicationStatusService {
  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    @Inject(REPLICATION_CONFIG) private readonly config: ReplicationConfig,
    private readonly clock: Clock,
  ) {}

  /** Full instance status: global counters + per-bucket breakdown + last error. */
  async getStatus(): Promise<ReplicationStatus> {
    const rows = await this.aggregate();
    const now = this.clock.nowMs();
    const perBucket = [...this.foldByBucket(rows, now).values()].sort((a, b) =>
      a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0,
    );

    const totals = perBucket.reduce(
      (acc, b) => {
        acc.pendingCount += b.pendingCount;
        acc.inflightCount += b.inflightCount;
        acc.failedCount += b.failedCount;
        if (b.oldestPendingAgeMs != null) {
          acc.oldestPendingAgeMs = Math.max(acc.oldestPendingAgeMs ?? 0, b.oldestPendingAgeMs);
        }
        return acc;
      },
      { pendingCount: 0, inflightCount: 0, failedCount: 0, oldestPendingAgeMs: null as number | null },
    );

    return {
      enabled: this.config.enabled,
      ...totals,
      lastError: await this.lastError(),
      perBucket,
    };
  }

  /** Single-bucket status (zeroed when the bucket has no outbox rows). */
  async getBucketStatus(bucket: string): Promise<BucketReplicationStatus> {
    const rows = await this.aggregate(bucket);
    const now = this.clock.nowMs();
    return (
      this.foldByBucket(rows, now).get(bucket) ?? {
        bucket,
        pendingCount: 0,
        inflightCount: 0,
        failedCount: 0,
        oldestPendingAgeMs: null,
      }
    );
  }

  /**
   * One GROUP-BY aggregate over `(bucket_name, status)` — count, the retrying
   * subset (attempts > 0), and the oldest `created_at` per group. Reads only
   * `pending`/`failed` rows (`done` rows are deleted post-send). Never loads
   * outbox rows into the identity map.
   */
  private async aggregate(bucket?: string): Promise<AggregateRow[]> {
    const qb = this.em
      .createQueryBuilder(ReplicationOutbox, 'o')
      .select([
        'o.bucket_name as bucket',
        'o.status as status',
        raw('count(*) as cnt'),
        raw('sum(case when o.attempts > 0 then 1 else 0 end) as retrying'),
        raw('min(o.created_at) as oldest'),
      ])
      .where({ status: { $in: ['pending', 'failed'] } });
    if (bucket !== undefined) qb.andWhere({ bucket });
    return (await qb.groupBy(['o.bucket_name', 'o.status']).execute('all')) as AggregateRow[];
  }

  /** Fold the aggregate rows into a per-bucket map, computing lag against `now`. */
  private foldByBucket(rows: AggregateRow[], nowMs: number): Map<string, BucketReplicationStatus> {
    const out = new Map<string, BucketReplicationStatus>();
    for (const r of rows) {
      const entry =
        out.get(r.bucket) ??
        ({
          bucket: r.bucket,
          pendingCount: 0,
          inflightCount: 0,
          failedCount: 0,
          oldestPendingAgeMs: null,
        } satisfies BucketReplicationStatus);

      const cnt = Number(r.cnt);
      if (r.status === 'pending') {
        const retrying = Number(r.retrying);
        entry.inflightCount += retrying;
        entry.pendingCount += Math.max(0, cnt - retrying);
        const oldestMs = toMs(r.oldest);
        if (!Number.isNaN(oldestMs)) {
          const age = Math.max(0, nowMs - oldestMs);
          entry.oldestPendingAgeMs =
            entry.oldestPendingAgeMs == null ? age : Math.max(entry.oldestPendingAgeMs, age);
        }
      } else if (r.status === 'failed') {
        entry.failedCount += cnt;
      }
      out.set(r.bucket, entry);
    }
    return out;
  }

  /**
   * The newest outbox row carrying a `lastError`, projected to its OWN
   * coordinates only. Redaction: the remote endpoint, target bucket and
   * credentials from the resolved config are NEVER read here — only the outbox
   * row's message/bucket/key. The message is bounded.
   */
  private async lastError(): Promise<ReplicationLastError | null> {
    const row = (await this.em
      .createQueryBuilder(ReplicationOutbox, 'o')
      .select([
        'o.last_error as message',
        'o.updated_at as at',
        'o.bucket_name as bucket',
        'o.key as key',
      ])
      .where({ lastError: { $ne: null } })
      .orderBy({ updatedAt: 'desc' })
      .limit(1)
      .execute('get')) as
      | { message: string | null; at: string | number | null; bucket: string; key: string }
      | undefined;

    if (!row || !row.message) return null;
    const atMs = toMs(row.at);
    return {
      message: String(row.message).slice(0, LAST_ERROR_MAX),
      at: Number.isNaN(atMs) ? new Date(0).toISOString() : new Date(atMs).toISOString(),
      bucket: row.bucket,
      key: row.key,
    };
  }
}

/**
 * Parse a raw driver datetime value to epoch ms. libsql returns `datetime`
 * columns as the stored string; with `forceUtcTimezone` that is a
 * space-separated UTC `YYYY-MM-DD HH:MM:SS[.sss]` with no zone suffix, which
 * `Date.parse` would read as LOCAL time. Normalise to ISO-with-Z first.
 */
function toMs(value: string | number | null | undefined): number {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  const s = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /([zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`;
  return Date.parse(withZone);
}
