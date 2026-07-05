import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the durable admin audit-event store (STORY-1103, TASK-3330): the
 * `audit_logs` table plus the four `(<col>, ts)` indexes that keep every
 * filterable query off a table scan (EPIC-08 DoS posture). MikroORM maps the
 * camelCase entity properties to snake_case columns (`requestId`→`request_id`,
 * `objectKey`→`object_key`, `keyId`→`key_id`). Forward-only in production
 * (§3.3.2); `down()` is a test-suite convenience only.
 */
export class Migration20260704000001_audit_logs extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "audit_logs" (` +
        `"id" varchar(64) not null, ` +
        `"ts" datetime not null, ` +
        `"event" varchar(64) not null, ` +
        `"subject" varchar(256) null, ` +
        `"request_id" varchar(64) null, ` +
        `"bucket" varchar(256) null, ` +
        `"object_key" varchar(1024) null, ` +
        `"key_id" varchar(64) null, ` +
        `"ip" varchar(64) null, ` +
        `"detail" text null, ` +
        `constraint "audit_logs_pkey" primary key ("id"));`,
    );
    this.addSql(`create index "ix_audit_ts" on "audit_logs" ("ts");`);
    this.addSql(`create index "ix_audit_event_ts" on "audit_logs" ("event", "ts");`);
    this.addSql(`create index "ix_audit_subject_ts" on "audit_logs" ("subject", "ts");`);
    this.addSql(`create index "ix_audit_bucket_ts" on "audit_logs" ("bucket", "ts");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "audit_logs";`);
  }
}
