import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `admin_users.must_change_password` (§5.2 / STORY-0401). Forces a password
 * change on next login for the first-run admin; surfaced as the
 * `mustChangePassword` access-token claim. Forward-only in production (§3.3.2);
 * `down()` is for test-suite convenience only.
 */
export class Migration20260603000001_admin_must_change_password extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "admin_users" add column "must_change_password" integer not null default 0;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "admin_users" drop column "must_change_password";`);
  }
}
