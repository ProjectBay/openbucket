import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EntityManager } from '@mikro-orm/core';
import { v7 as uuidv7 } from 'uuid';

import { AppConfigService } from '../common/config/app-config.service';
import { EventDeliveryEntity } from '../persistence/entities/event-delivery.entity';
import type { ObjectEvent } from './object-event.types';

/**
 * The façade the storage/domain layer emits object events through (STORY-0801).
 * Two seams, deliberately separate:
 *
 *  - `emitInProcess(event)` — fire-and-forget in-process dispatch to any host
 *    `@OnObjectCreated/@OnObjectDeleted/@OnMultipartCompleted` handler. Called
 *    AFTER `em.commit()`. Handler errors are isolated; the write path never
 *    blocks or fails on a handler.
 *  - `enqueueInTx(em, event)` — persists a durable webhook-delivery row on the
 *    SAME `em` the writer/delete already holds, BEFORE its `em.commit()`, so the
 *    outbox row is committed atomically with the object (transactional outbox).
 */
@Injectable()
export class ObjectEventsService {
  private readonly log = new Logger(ObjectEventsService.name);

  constructor(
    private readonly emitter: EventEmitter2,
    // Optional so unit tests (and pure-embedding users who never configure
    // webhooks) can construct/inject the service without the config provider.
    @Optional() private readonly config?: AppConfigService,
  ) {}

  /**
   * Fire-and-forget in-process dispatch. `emitAsync` lets async handlers be
   * awaited by the emitter, but we do NOT await it here — the data plane must
   * never block on, or fail because of, a handler. Deferred through a microtask
   * so BOTH a synchronous throw and an async rejection from a handler are caught
   * + logged rather than propagating. Returns synchronously.
   */
  emitInProcess(event: ObjectEvent): void {
    Promise.resolve()
      .then(() => this.emitter.emitAsync(event.type, event))
      .catch((err) =>
        this.log.error(
          `object-event handler failed for ${event.type} ${event.bucket}/${event.key}`,
          err as Error,
        ),
      );
  }

  /**
   * Persist a durable webhook-delivery row inside the caller's open transaction
   * (transactional outbox). No-op unless webhooks are enabled (a `WEBHOOK_URL`
   * is set) AND the event type is in the configured event filter, so the table
   * stays empty and the write path pays ~zero for pure in-process embedders.
   *
   * The stored `payload` is the exact `JSON.stringify(event)` the delivery runner
   * later signs + sends, so the persisted body and the HMAC signature cover
   * identical bytes. Persist only — the surrounding `em.commit()` flushes it
   * atomically with the object row (and rolls it back if the write aborts).
   */
  enqueueInTx(em: EntityManager, event: ObjectEvent): void {
    if (!this.config?.webhooksEnabled) return;
    if (!this.config.webhookEvents.includes(event.type)) return;
    const row = em.create(EventDeliveryEntity, {
      id: uuidv7(),
      eventType: event.type,
      payload: JSON.stringify(event),
      nextAttemptAt: new Date(),
    });
    em.persist(row);
  }
}
