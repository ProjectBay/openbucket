import { Migration } from '@mikro-orm/migrations';

/**
 * Creates the `object_tags` denormalised tag-index table (STORY-1101,
 * TASK-3312). One row per (object, tagKey, tagValue) pair, kept in sync on the
 * tagging write path and backfilled by a background tick. Backs the index-backed
 * `tagKey`/`tagValue` filter of cross-bucket object search — the unindexed
 * `objects.tagging` JSON column stays the source of truth.
 *
 * Both FKs cascade on delete so removing an object (or its bucket) reaps the tag
 * rows automatically — no orphans. `ix_object_tags_kv` powers the exact-match
 * (key, value) lookup; `ix_object_tags_object` speeds per-object rebuilds. This
 * migration is strictly additive: it creates a new table only, touching no
 * existing row. Forward-only in production (§3.3.2); `down()` is for the test
 * suite only.
 */
export class Migration20260704000001_object_tags_index extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "object_tags" (
      "id"          varchar(64)  not null primary key,
      "object_id"   varchar(64)  not null,
      "bucket_name" varchar(63)  not null,
      "tag_key"     varchar(128) not null,
      "tag_value"   varchar(256) not null,
      constraint "object_tags_object_id_foreign" foreign key ("object_id")
        references "objects" ("id") on update cascade on delete cascade,
      constraint "object_tags_bucket_name_foreign" foreign key ("bucket_name")
        references "buckets" ("name") on update cascade on delete cascade
    );`);
    this.addSql(
      `create index "ix_object_tags_kv" on "object_tags" ("tag_key", "tag_value");`,
    );
    this.addSql(`create index "ix_object_tags_object" on "object_tags" ("object_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "object_tags";`);
  }
}
