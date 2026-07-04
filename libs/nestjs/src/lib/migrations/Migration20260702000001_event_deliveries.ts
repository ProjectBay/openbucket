import { Migration } from '@mikro-orm/migrations';

/**
 * Creates the `event_deliveries` table — the durable webhook outbox
 * (STORY-0801). A `pending` row is inserted inside the same transaction as the
 * object write; the `WebhookDeliveryRunner` scans due rows via the composite
 * `ix_delivery_due (status, next_attempt_at)` index. Forward-only in production
 * (§3.3.2); `down()` is for test-suite convenience only.
 */
export class Migration20260702000001_event_deliveries extends Migration {
  override async up(): Promise<void> {
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
    this.addSql(
      `create index "ix_delivery_due" on "event_deliveries" ("status", "next_attempt_at");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "event_deliveries";`);
  }
}
