import { EntityRepository } from '@mikro-orm/libsql';

import { EventDeliveryEntity } from '../entities/event-delivery.entity';

/**
 * Webhook-outbox persistence (STORY-0801). Two bounded queries the
 * `WebhookDeliveryRunner` drives every tick:
 *  - `findDue` — the next batch of pending rows whose backoff has elapsed,
 *    oldest-first, `LIMIT`-bounded so a backlog drains in fixed-size chunks
 *    (CWE-770).
 *  - `pruneTerminal` — deletes terminal (`delivered`/`failed`) rows older than
 *    the retention window so the table can't grow without bound.
 */
export class EventDeliveryRepository extends EntityRepository<EventDeliveryEntity> {
  /** Pending rows due for delivery (`next_attempt_at <= now`), oldest-first. */
  async findDue(now: Date, limit: number): Promise<EventDeliveryEntity[]> {
    return this.find(
      { status: 'pending', nextAttemptAt: { $lte: now } },
      { orderBy: { nextAttemptAt: 'asc' }, limit },
    );
  }

  /**
   * Delete terminal rows created before `now - retentionMs`. Returns the number
   * of rows removed. Only `delivered`/`failed` rows are eligible; a still-retrying
   * `pending` row is never pruned regardless of age.
   */
  async pruneTerminal(now: Date, retentionMs: number): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionMs);
    return this.getEntityManager().nativeDelete(EventDeliveryEntity, {
      status: { $in: ['delivered', 'failed'] },
      createdAt: { $lt: cutoff },
    });
  }
}
