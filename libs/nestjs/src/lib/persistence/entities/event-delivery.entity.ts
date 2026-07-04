import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

import { EventDeliveryRepository } from '../repositories/event-delivery.repository';

/** Lifecycle of a webhook delivery row. `delivered`/`failed` are terminal. */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

/**
 * A durable webhook-delivery row — the transactional outbox for object-event
 * notifications (STORY-0801). Written inside the same transaction as the object
 * write (`ObjectEventsService.enqueueInTx`) so it commits atomically with the
 * object and survives a crash; the `WebhookDeliveryRunner` drains it.
 *
 * No secret is stored here: the HMAC secret lives only in config. `payload` is
 * the plain event JSON — the exact bytes the runner signs + sends — safe to
 * persist and to surface in an admin view. The composite `ix_delivery_due` index
 * backs the runner's `status='pending' AND next_attempt_at <= now` due-scan.
 */
@Entity({ tableName: 'event_deliveries', repository: () => EventDeliveryRepository })
@Index({ name: 'ix_delivery_due', properties: ['status', 'nextAttemptAt'] })
export class EventDeliveryEntity {
  /** uuidv7 — time-sortable; doubles as the `X-OpenBucket-Delivery` id. */
  @PrimaryKey({ type: 'string', length: 64 })
  id!: string;

  /** `object.created` | `object.deleted` | `multipart.completed`. */
  @Property({ type: 'string', length: 48 })
  eventType!: string;

  /** Canonical JSON body actually signed + sent (`JSON.stringify(event)`). */
  @Property({ type: 'text' })
  payload!: string;

  @Property({ type: 'string', length: 16 })
  status: DeliveryStatus = 'pending';

  @Property({ type: 'integer' })
  attempts = 0;

  @Property({ type: 'datetime' })
  nextAttemptAt: Date = new Date();

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deliveredAt?: Date | null;

  /** Status code / error name of the last failed attempt — never the secret. */
  @Property({ type: 'string', length: 512, nullable: true })
  lastError?: string | null;
}
