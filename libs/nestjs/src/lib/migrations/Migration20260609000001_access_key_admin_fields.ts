import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the admin key-management columns to `access_keys` (§5.7): the uuid-v7
 * `id` (the admin-facing identifier), `role`, and `last_used_at`.
 *
 * The table carries no rows before the admin key API exists — the root key is
 * loaded from env into memory, never persisted — so this drops and recreates it
 * rather than doing piecemeal ALTERs (SQLite can't add a NOT NULL UNIQUE column
 * to a populated table without a default). Forward-only (§3.3.2); `down()`
 * restores the initial shape for test rollback.
 */
export class Migration20260609000001_access_key_admin_fields extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop table if exists "access_keys";`);
    this.addSql(`
      create table "access_keys" (
        "access_key_id" text       not null primary key,
        "id"            text       not null,
        "secret_hash"   text       not null,
        "label"         text       not null default '',
        "role"          text       not null default 'root',
        "created_at"    datetime   not null,
        "last_used_at"  datetime   null,
        "disabled"      boolean    not null default 0
      );
    `);
    this.addSql(`create unique index "uq_access_keys_id" on "access_keys" ("id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "access_keys";`);
    this.addSql(`
      create table "access_keys" (
        "access_key_id" text       not null primary key,
        "secret_hash"   text       not null,
        "label"         text       not null default '',
        "created_at"    datetime   not null,
        "disabled"      boolean    not null default 0
      );
    `);
  }
}
