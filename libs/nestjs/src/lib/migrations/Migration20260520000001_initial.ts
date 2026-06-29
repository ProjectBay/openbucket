import { Migration } from '@mikro-orm/migrations';

/**
 * Initial schema (WHITEPAPER §3.3.1). Forward-only in production (§3.3.2);
 * `down()` exists for test-suite convenience only and must never run in prod.
 */
export class Migration20260520000001_initial extends Migration {
  override async up(): Promise<void> {
    // ----- buckets ---------------------------------------------------------
    this.addSql(`
      create table "buckets" (
        "name"          text       not null primary key,
        "region"        text       not null default 'us-east-1',
        "versioning"    text       not null default 'disabled',
        "object_lock"   text       null,
        "encryption"    text       null,
        "cors"          text       null,
        "lifecycle"     text       null,
        "tagging"       text       null,
        "policy"        text       null,
        "created_at"    datetime   not null,
        "modified_at"   datetime   not null
      );
    `);

    // ----- objects ---------------------------------------------------------
    this.addSql(`
      create table "objects" (
        "id"                  text       not null primary key,
        "bucket_name"         text       not null,
        "key"                 text       not null,
        "current_version_id"  text       null,
        "size"                bigint     not null default 0,
        "etag"                text       not null,
        "content_type"        text       not null default 'application/octet-stream',
        "user_metadata"       text       null,
        "tagging"             text       null,
        "lock"                text       null,
        "storage_class"       text       not null default 'STANDARD',
        "soft_deleted"        boolean    not null default 0,
        "created_at"          datetime   not null,
        "modified_at"         datetime   not null,
        constraint "fk_objects_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create unique index "uq_objects_bucket_key" on "objects" ("bucket_name", "key");`);
    this.addSql(`create index "ix_objects_bucket_key" on "objects" ("bucket_name", "key");`);
    this.addSql(`create index "ix_objects_bucket_softdeleted" on "objects" ("bucket_name", "soft_deleted");`);

    // ----- object_versions -------------------------------------------------
    this.addSql(`
      create table "object_versions" (
        "bucket_name"      text       not null,
        "key"              text       not null,
        "version_id"       text       not null,
        "size"             bigint     not null default 0,
        "etag"             text       not null,
        "content_type"     text       not null default 'application/octet-stream',
        "user_metadata"    text       null,
        "is_delete_marker" boolean    not null default 0,
        "created_at"       datetime   not null,
        primary key ("bucket_name", "key", "version_id"),
        constraint "fk_versions_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create index "ix_versions_bucket_key_version" on "object_versions" ("bucket_name", "key", "version_id");`);
    this.addSql(`create index "ix_versions_bucket_key_created" on "object_versions" ("bucket_name", "key", "created_at");`);

    // ----- multipart_uploads ----------------------------------------------
    this.addSql(`
      create table "multipart_uploads" (
        "upload_id"     text       not null primary key,
        "bucket_name"   text       not null,
        "key"           text       not null,
        "initiator"     text       not null default 'root',
        "encryption"    text       null,
        "content_type"  text       not null default 'application/octet-stream',
        "user_metadata" text       null,
        "initiated_at"  datetime   not null,
        constraint "fk_mpu_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
    this.addSql(`create index "ix_mpu_bucket_key" on "multipart_uploads" ("bucket_name", "key");`);
    this.addSql(`create index "ix_mpu_initiated" on "multipart_uploads" ("initiated_at");`);

    // ----- multipart_parts ------------------------------------------------
    this.addSql(`
      create table "multipart_parts" (
        "upload_id"        text       not null,
        "part_number"      integer    not null,
        "size"             bigint     not null default 0,
        "etag"             text       not null,
        "checksum_sha256"  text       null,
        "written_at"       datetime   not null,
        primary key ("upload_id", "part_number"),
        constraint "fk_mpp_upload"
          foreign key ("upload_id") references "multipart_uploads" ("upload_id") on delete cascade
      );
    `);
    this.addSql(`create index "ix_mpp_upload_part" on "multipart_parts" ("upload_id", "part_number");`);

    // ----- access_keys ----------------------------------------------------
    this.addSql(`
      create table "access_keys" (
        "access_key_id" text       not null primary key,
        "secret_hash"   text       not null,
        "label"         text       not null default '',
        "created_at"    datetime   not null,
        "disabled"      boolean    not null default 0
      );
    `);

    // ----- admin_users ----------------------------------------------------
    this.addSql(`
      create table "admin_users" (
        "username"      text       not null primary key,
        "password_hash" text       not null,
        "created_at"    datetime   not null
      );
    `);

    // ----- refresh_tokens -------------------------------------------------
    this.addSql(`
      create table "refresh_tokens" (
        "id"           text       not null primary key,
        "token_hash"   text       not null,
        "subject"      text       not null,
        "issued_at"    datetime   not null,
        "expires_at"   datetime   not null,
        "rotated_from" text       null
      );
    `);
    this.addSql(`create index "ix_refresh_subject" on "refresh_tokens" ("subject");`);
    this.addSql(`create index "ix_refresh_expires" on "refresh_tokens" ("expires_at");`);

    // ----- lifecycle_state ------------------------------------------------
    this.addSql(`
      create table "lifecycle_state" (
        "bucket_name"        text       not null,
        "rule_id"            text       not null,
        "last_sweep_at"      datetime   null,
        "last_key_processed" text       null,
        primary key ("bucket_name", "rule_id"),
        constraint "fk_lcs_bucket"
          foreign key ("bucket_name") references "buckets" ("name") on delete cascade
      );
    `);
  }

  /**
   * Down-migrations are emitted by the generator but are not part of the
   * supported operational story (§3.3.2). Kept for tests only.
   */
  override async down(): Promise<void> {
    this.addSql('drop table if exists "lifecycle_state";');
    this.addSql('drop table if exists "refresh_tokens";');
    this.addSql('drop table if exists "admin_users";');
    this.addSql('drop table if exists "access_keys";');
    this.addSql('drop table if exists "multipart_parts";');
    this.addSql('drop table if exists "multipart_uploads";');
    this.addSql('drop table if exists "object_versions";');
    this.addSql('drop table if exists "objects";');
    this.addSql('drop table if exists "buckets";');
  }
}
