import { Migration } from '@mikro-orm/migrations';

/**
 * Per-object integrity scrub verdict (STORY-1204). Adds the three integrity
 * columns to `objects` plus the `ix_objects_integrity` index so the admin
 * corrupt-list is an index scan and the scrubber can prefer least-recently-checked
 * rows without a full-table sort.
 *
 * Forward-only and strictly additive (§3.3.2): `integrity_status` defaults to
 * `'unchecked'` and the remaining columns are nullable, so every pre-existing row
 * is valid and readable by an old binary and is simply `unchecked` until the scrub
 * reaches it (mirrors how `content_sha256` was added nullable). SQLite adds columns
 * cheaply (no table rebuild). `down()` is for test-suite convenience only.
 */
export class Migration20260716000001_object_integrity extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "objects" add column "integrity_status" varchar(255) not null default 'unchecked';`,
    );
    this.addSql(`alter table "objects" add column "integrity_checked_at" datetime null;`);
    this.addSql(`alter table "objects" add column "integrity_detail" varchar(255) null;`);
    this.addSql(
      `create index "ix_objects_integrity" on "objects" ("integrity_status", "integrity_checked_at");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "ix_objects_integrity";`);
    this.addSql(`alter table "objects" drop column "integrity_detail";`);
    this.addSql(`alter table "objects" drop column "integrity_checked_at";`);
    this.addSql(`alter table "objects" drop column "integrity_status";`);
  }
}
