---
id: TASK-2412
title: Add the durable webhook outbox entity, migration, and transactional enqueue
story: STORY-0801
status: backlog
type: implementation
size: M
---

## Description
Give standalone webhooks durable at-least-once semantics with a transactional outbox: a new `event_deliveries` table, its MikroORM entity, and an `ObjectEventsService.enqueueInTx(em, event)` seam that persists a pending delivery row inside the SAME transaction as the object write. Because the row is committed atomically with the object, a crash after commit still leaves a durable, retriable delivery — no event is lost and none is delivered for a rolled-back write. The delivery runner ([TASK-2413]) drains this table.

## Files to create / modify
- `libs/nestjs/src/lib/persistence/entities/event-delivery.entity.ts` — new (`EventDeliveryEntity`, table `event_deliveries`).
- `libs/nestjs/src/lib/persistence/index.ts` — modify: `export * from './entities/event-delivery.entity'` (after line 13).
- `libs/nestjs/src/lib/migrations/Migration20260702000001_event_deliveries.ts` — new (create table + index).
- `libs/nestjs/src/lib/mikro-orm.config.ts` — modify: add `EventDeliveryEntity` to the `entities` array (line 37).
- `libs/nestjs/src/lib/persistence.module.ts` — modify: register `EventDeliveryEntity` in the Nest-runtime entity list (the ConfigService-derived equivalent noted in `mikro-orm.config.ts:20`).
- `libs/nestjs/src/lib/events/object-events.service.ts` — modify: add `enqueueInTx(em, event)`; inject `@Optional() AppConfigService` to gate on `webhooksEnabled` + event filter.
- `libs/nestjs/src/lib/storage/object-writer.service.ts` / `domain/objects/object.service.ts` — modify: call `enqueueInTx(em, event)` BEFORE `em.commit()` at each emit site added in [TASK-2411].

## Implementation notes
- Entity mirrors the `RefreshToken` entity+index style (`refresh-token.entity.ts`), keyed by a uuidv7 (sortable, doubles as the `X-OpenBucket-Delivery` id):
  ```ts
  export type DeliveryStatus = 'pending' | 'delivered' | 'failed';
  @Entity({ tableName: 'event_deliveries', repository: () => EventDeliveryRepository })
  @Index({ name: 'ix_delivery_due', properties: ['status', 'nextAttemptAt'] })
  export class EventDeliveryEntity {
    @PrimaryKey({ type: 'string', length: 64 }) id!: string;        // uuidv7
    @Property({ type: 'string', length: 48 }) eventType!: string;   // object.created | ...
    @Property({ type: 'text' }) payload!: string;                   // canonical JSON body actually signed+sent
    @Property({ type: 'string', length: 16 }) status: DeliveryStatus = 'pending';
    @Property({ type: 'integer' }) attempts = 0;
    @Property({ type: 'datetime' }) nextAttemptAt: Date = new Date();
    @Property({ type: 'datetime' }) createdAt: Date = new Date();
    @Property({ type: 'datetime', nullable: true }) deliveredAt?: Date | null;
    @Property({ type: 'string', length: 512, nullable: true }) lastError?: string | null;
  }
  ```
- Migration follows the forward-only, hand-written-SQL exemplar (`Migration20260701000001_object_content_sha256.ts`); `down()` is test-convenience only:
  ```ts
  this.addSql(`create table "event_deliveries" (
    "id" varchar(64) not null primary key,
    "event_type" varchar(48) not null,
    "payload" text not null,
    "status" varchar(16) not null default 'pending',
    "attempts" integer not null default 0,
    "next_attempt_at" datetime not null,
    "created_at" datetime not null,
    "delivered_at" datetime null,
    "last_error" varchar(512) null
  );`);
  this.addSql(`create index "ix_delivery_due" on "event_deliveries" ("status", "next_attempt_at");`);
  ```
- **Canonical payload = signed payload**: `enqueueInTx` stores `JSON.stringify(event)` and the runner signs+sends that exact string, so the persisted body and the signature cover identical bytes (no re-serialization drift). Build the row with `em.create(EventDeliveryEntity, { id: uuidv7(), eventType: event.type, payload: JSON.stringify(event), nextAttemptAt: new Date() })` and `em.persist(row)` on the SAME forked EM the writer/delete already holds — do NOT `flush`; the surrounding `em.commit()` flushes it atomically with the object row.
- **Gating**: `enqueueInTx` is a no-op unless `config?.webhooksEnabled` (url set) and the event type is in `config.webhookEvents` (default = all three). This keeps the table empty and the write path cost ~zero for embedders who only use in-process events.
- **Ordering**: enqueue is pre-commit (in-tx); the in-process emit ([TASK-2411]) is post-commit. A rolled-back write rolls back the outbox row too — assert an aborted write leaves `event_deliveries` empty.
- **DoS / unbounded growth (CWE-770)**: the row payload is bounded (key length already capped by `key-codec`; no metadata/headers included). Retention/pruning of `delivered`/`failed` rows is handled by the runner ([TASK-2413]) so the table cannot grow without bound.
- **Security**: no secret is stored in the row (the HMAC secret lives only in config); `payload` is plain event JSON, safe to persist and to expose in an admin view later.

## Acceptance criteria
- [ ] `nx run nestjs:migration:up` (or the boot-time migrator) creates `event_deliveries` with the composite `ix_delivery_due` index.
- [ ] With webhooks enabled, a committed write inserts exactly one `pending` row whose `payload` round-trips to the emitted `ObjectEvent`.
- [ ] With webhooks disabled (no url), no row is inserted.
- [ ] A write that rolls back leaves zero `event_deliveries` rows (transactional outbox proven).
- [ ] `EventDeliveryEntity` is discovered by both the CLI config and the Nest-runtime entity list (schema validates in a spec).

## Test obligations
- Unit: covered by [TEST-0801] (cases 8–9).
- E2E: covered by [TEST-0801] (case 12).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2410] (event contract/service), [TASK-2414] (`AppConfigService.webhooksEnabled`/`webhookEvents` getters); coordinates with [TASK-2411] emit sites.

## References
- `libs/nestjs/src/lib/persistence/entities/refresh-token.entity.ts` (entity + `@Index` exemplar).
- `libs/nestjs/src/lib/migrations/Migration20260701000001_object_content_sha256.ts` (migration exemplar).
- `libs/nestjs/src/lib/mikro-orm.config.ts:20,37` (entity registration), `persistence/index.ts:13`, `persistence.module.ts`.
- `libs/nestjs/src/lib/storage/object-writer.service.ts:218` (`em.persist(row)` — enqueue adjacent, pre-commit).
</content>
