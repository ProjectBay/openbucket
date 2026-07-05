import { Migration } from '@mikro-orm/migrations';

/**
 * Cold-object tiering data model (STORY-0901). Adds the physical-location columns
 * to `objects` and `object_versions` and creates the per-rule tiering sweep cursor
 * table `tiering_state` (mirrors `lifecycle_state`).
 *
 * Forward-only and strictly additive (§3.3.2): `location` defaults to `'local'`
 * and the remaining columns are nullable, so every pre-existing row is served
 * exactly as before and an old binary can still read the rows. `down()` is for
 * test-suite convenience only.
 */
export class Migration20260711000001_object_tiering extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "objects" add column "location" varchar(16) not null default 'local';`);
    this.addSql(`alter table "objects" add column "remote_key" text null;`);
    this.addSql(`alter table "objects" add column "tiered_at" datetime null;`);
    this.addSql(`alter table "objects" add column "last_accessed_at" datetime null;`);
    this.addSql(`create index "ix_objects_lastaccessed" on "objects" ("last_accessed_at");`);

    this.addSql(
      `alter table "object_versions" add column "location" varchar(16) not null default 'local';`,
    );
    this.addSql(`alter table "object_versions" add column "remote_key" text null;`);
    this.addSql(`alter table "object_versions" add column "tiered_at" datetime null;`);
    this.addSql(`alter table "object_versions" add column "last_accessed_at" datetime null;`);

    this.addSql(`create table "tiering_state" (
      "bucket_name" varchar(63) not null,
      "rule_id" varchar(64) not null,
      "last_sweep_at" datetime null,
      "last_key_processed" text null,
      constraint "tiering_state_bucket_name_foreign" foreign key ("bucket_name")
        references "buckets" ("name") on update cascade on delete cascade,
      primary key ("bucket_name", "rule_id")
    );`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tiering_state";`);
    this.addSql(`drop index if exists "ix_objects_lastaccessed";`);
    this.addSql(`alter table "objects" drop column "last_accessed_at";`);
    this.addSql(`alter table "objects" drop column "tiered_at";`);
    this.addSql(`alter table "objects" drop column "remote_key";`);
    this.addSql(`alter table "objects" drop column "location";`);
    this.addSql(`alter table "object_versions" drop column "last_accessed_at";`);
    this.addSql(`alter table "object_versions" drop column "tiered_at";`);
    this.addSql(`alter table "object_versions" drop column "remote_key";`);
    this.addSql(`alter table "object_versions" drop column "location";`);
  }
}
