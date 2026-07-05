import { EntityRepository, type FilterQuery } from '@mikro-orm/libsql';

import { AuditLog } from '../entities/audit-log.entity';

/** Insert payload for one buffered audit row (mirrors {@link AuditLog} columns). */
export interface AuditRow {
  id: string;
  ts: Date;
  event: string;
  subject: string | null;
  requestId: string | null;
  bucket: string | null;
  objectKey: string | null;
  keyId: string | null;
  ip: string | null;
  detail: string | null;
}

/**
 * A validated audit query (built by `AuditQueryService` from the request DTO).
 * Every filter is optional and matches an INDEXED column by exact value (or a
 * `ts` range) — never `$like` — so no query can degrade to a table scan.
 * `before` is the decoded keyset cursor `(ts, id)` of the previous page's last
 * row; `limit` is the caller cap (the repo fetches `limit + 1` to signal more).
 */
export interface AuditFilter {
  event?: string;
  subject?: string;
  bucket?: string;
  from?: Date;
  to?: Date;
  before?: { ts: Date; id: string };
  limit: number;
}

/**
 * Persistence for {@link AuditLog} (STORY-1103): batch insert from the flush
 * tick, newest-first keyset query for the viewer API, and a retention prune.
 * Extends the libsql `EntityRepository` like {@link RefreshTokenRepository}.
 */
export class AuditLogRepository extends EntityRepository<AuditLog> {
  /**
   * Persist a drained batch in a single flush (kept off the request path).
   * Returns the inserted ids to stay signature-compatible with the overridden
   * `EntityRepository.insertMany` (which resolves to the primary keys), mirroring
   * how {@link RefreshTokenRepository.insert} keeps its base-compatible return.
   */
  async insertMany(rows: AuditRow[]): Promise<string[]> {
    if (rows.length === 0) return [];
    const em = this.getEntityManager();
    const entities = rows.map((row) => em.create(AuditLog, row));
    await em.flush();
    return entities.map((e) => e.id);
  }

  /**
   * Return up to `limit + 1` rows newest-first, honouring the supplied exact
   * filters, the optional `ts` range, and the `(ts, id) < (before.ts, before.id)`
   * keyset predicate. The caller pops the extra row to derive `hasMore`.
   */
  async query(f: AuditFilter): Promise<AuditLog[]> {
    const and: FilterQuery<AuditLog>[] = [];
    if (f.event !== undefined) and.push({ event: f.event });
    if (f.subject !== undefined) and.push({ subject: f.subject });
    if (f.bucket !== undefined) and.push({ bucket: f.bucket });
    if (f.from) and.push({ ts: { $gte: f.from } });
    if (f.to) and.push({ ts: { $lte: f.to } });
    if (f.before) {
      // Strict lexicographic `(ts, id) < (cursorTs, cursorId)` over the DESC order.
      and.push({
        $or: [
          { ts: { $lt: f.before.ts } },
          { ts: f.before.ts, id: { $lt: f.before.id } },
        ],
      });
    }
    const where: FilterQuery<AuditLog> = and.length > 0 ? { $and: and } : {};
    return this.find(where, {
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      limit: f.limit + 1,
    });
  }

  /** Delete every row older than `cutoff`; returns the deleted count. */
  async pruneOlderThan(cutoff: Date): Promise<number> {
    return this.getEntityManager().nativeDelete(AuditLog, { ts: { $lt: cutoff } });
  }
}
