import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `admin_users.role` (EPIC-11, STORY-1002). Text-stored enum
 * (`admin` | `readonly`) with a `default 'admin'` that backfills the seeded
 * bootstrap row and every pre-migration admin to a full operator — a `readonly`
 * default would silently lock out the only operator (regression + DoS-on-self).
 * Forward-only in production (§3.3.2); `down()` is for test-suite convenience.
 */
export class Migration20260704000001_admin_user_roles extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "admin_users" add column "role" text not null default 'admin';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "admin_users" drop column "role";`);
  }
}
