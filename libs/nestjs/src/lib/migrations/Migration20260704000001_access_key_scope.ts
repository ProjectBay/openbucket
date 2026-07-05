import { Migration } from '@mikro-orm/migrations';

/**
 * Add the scoped-sub-key columns to `access_keys` (EPIC-11, STORY-1000):
 *  - `scope_policy`     — compiled scope `PolicyDocument` (JSON text), null ⇒ unscoped
 *  - `secret_encrypted` — the sub-key secret encrypted at rest (AES-256-GCM), so
 *                         SigV4 can recover a plaintext to verify a signature.
 *
 * Both are nullable with no default, so this is a plain additive ALTER (no
 * NOT NULL/UNIQUE constraint) — safe even if the table already holds sub-keys,
 * and existing rows plus the env-loaded root key are unaffected (they read null).
 * Forward-only (§3.3.2); `down()` drops the two columns for test rollback.
 */
export class Migration20260704000001_access_key_scope extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "access_keys" add column "scope_policy" text null;`);
    this.addSql(`alter table "access_keys" add column "secret_encrypted" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "access_keys" drop column "secret_encrypted";`);
    this.addSql(`alter table "access_keys" drop column "scope_policy";`);
  }
}
