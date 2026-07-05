import { Migration } from '@mikro-orm/migrations';

/**
 * Creates the `replication_outbox` table — the durable transactional outbox for
 * async replication to an external S3-compatible target (STORY-0900). A `pending`
 * row is inserted inside the same transaction as the object write; the
 * `ReplicationWorkerRunner` scans due rows via the composite `ix_repl_outbox_due
 * (status, next_attempt_at)` index and processes each key's chain in
 * `ix_repl_outbox_key (bucket_name, key, seq)` order.
 *
 * FK `bucket_name → buckets(name) on delete cascade` so deleting a bucket drops
 * its pending intents. Forward-only in production (§3.3.2); `down()` is for
 * test-suite convenience only.
 */
export class Migration20260710000001_replication_outbox extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "replication_outbox" (
      "id" varchar(64) not null primary key,
      "seq" bigint not null,
      "bucket_name" varchar(63) not null,
      "key" text not null,
      "op" varchar(8) not null,
      "version_id" varchar null,
      "etag" varchar(64) null,
      "size" bigint null,
      "content_type" varchar(255) null,
      "status" varchar(16) not null default 'pending',
      "attempts" integer not null default 0,
      "next_attempt_at" datetime not null,
      "last_error" text null,
      "created_at" datetime not null,
      "updated_at" datetime not null,
      constraint "replication_outbox_bucket_name_foreign" foreign key ("bucket_name")
        references "buckets" ("name") on update cascade on delete cascade
    );`);
    this.addSql(
      `create index "ix_repl_outbox_due" on "replication_outbox" ("status", "next_attempt_at");`,
    );
    this.addSql(
      `create index "ix_repl_outbox_key" on "replication_outbox" ("bucket_name", "key", "seq");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "replication_outbox";`);
  }
}
