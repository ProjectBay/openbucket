import { Migration } from '@mikro-orm/migrations';

/**
 * Redesigns `refresh_tokens` for the §5.2.3 rotation/reuse-revocation scheme
 * (STORY-0402): the single `token_hash` becomes an indexed SHA-256 `lookup`
 * plus an argon2id `hash`, with `username`, `rotated_at`, and `revoked_at`
 * added and `subject`/`rotated_from` renamed to `subject_id`/`rotated_from_id`.
 *
 * The table carries no rows before the auth endpoints exist, so this drops and
 * recreates it rather than doing a piecemeal column migration. Forward-only in
 * production (§3.3.2); `down()` restores the initial shape for test rollback.
 */
export class Migration20260603000002_refresh_token_redesign extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop table if exists "refresh_tokens";`);
    this.addSql(`
      create table "refresh_tokens" (
        "id"              text       not null primary key,
        "lookup"          text       not null,
        "hash"            text       not null,
        "subject_id"      text       not null,
        "username"        text       not null,
        "issued_at"       datetime   not null,
        "expires_at"      datetime   not null,
        "rotated_from_id" text       null,
        "rotated_at"      datetime   null,
        "revoked_at"      datetime   null
      );
    `);
    this.addSql(`create index "ix_refresh_lookup" on "refresh_tokens" ("lookup");`);
    this.addSql(`create index "ix_refresh_subject" on "refresh_tokens" ("subject_id");`);
    this.addSql(`create index "ix_refresh_expires" on "refresh_tokens" ("expires_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "refresh_tokens";`);
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
  }
}
