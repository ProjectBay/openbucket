import { Migration } from '@mikro-orm/migrations';

/**
 * Creates the `scrub_state` table — the durable single-row state of the
 * background integrity scrubber (STORY-1204): the keyset resume cursor, the
 * `last_run_at` stamp, lifetime counters (`scanned`/`corrupt_found`/`repaired`)
 * that the admin status endpoint reads. Exactly one row (`id = 'default'`) is
 * used. The admin "scrub now" trigger is an in-memory flag on the runner, so no
 * column is needed for it here.
 *
 * Forward-only in production (§3.3.2); `down()` is for test-suite convenience.
 */
export class Migration20260716000002_scrub_state extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "scrub_state" (
      "id" varchar(32) not null primary key,
      "cursor_bucket" varchar(63) null,
      "cursor_key" text null,
      "last_run_at" datetime null,
      "scanned" integer not null default 0,
      "corrupt_found" integer not null default 0,
      "repaired" integer not null default 0
    );`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "scrub_state";`);
  }
}
