import { Migration } from '@mikro-orm/migrations';

/**
 * Creates the `reconcile_job` table — the durable state of a reconcile/backfill
 * job (STORY-0902). A job pages local objects, diffs them against the remote S3
 * target, and re-enqueues missing/divergent objects into `replication_outbox`.
 * The row survives a restart (resume via `cursor_bucket`/`cursor_key`) and the
 * admin console polls it.
 *
 * `active_flag` is `'active'` while a job is queued/running and NULL when
 * terminal; the unique index `uq_reconcile_active` (NULLs distinct in SQLite)
 * therefore admits any number of finished jobs but at most one active one — the
 * single-flight DoS guard. `bucket` is a plain column (no FK) so a bucket deleted
 * mid-scan does not drop the job. Forward-only in production (§3.3.2); `down()`
 * is for test-suite convenience only.
 */
export class Migration20260712000001_reconcile_job extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "reconcile_job" (
      "id" varchar(64) not null primary key,
      "scope" varchar(16) not null,
      "bucket" varchar(63) null,
      "state" varchar(16) not null default 'queued',
      "local_scanned" integer not null default 0,
      "remote_scanned" integer not null default 0,
      "missing_requeued" integer not null default 0,
      "cursor_bucket" varchar(63) null,
      "cursor_key" text null,
      "subject" varchar(255) null,
      "started_at" datetime null,
      "finished_at" datetime null,
      "error" text null,
      "active_flag" varchar(8) null,
      "created_at" datetime not null
    );`);
    this.addSql(
      `create unique index "uq_reconcile_active" on "reconcile_job" ("active_flag");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "reconcile_job";`);
  }
}
