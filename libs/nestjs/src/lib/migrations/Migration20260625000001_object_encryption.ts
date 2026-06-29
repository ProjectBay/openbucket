import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `objects.encryption` (STORY-0122) — per-object SSE-S3 at-rest state
 * (`{ algorithm, iv }` JSON; null ⇒ plaintext blob). Forward-only in production
 * (§3.3.2); `down()` is for test-suite convenience only.
 */
export class Migration20260625000001_object_encryption extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "objects" add column "encryption" text null;`);
    this.addSql(`alter table "object_versions" add column "encryption" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "objects" drop column "encryption";`);
    this.addSql(`alter table "object_versions" drop column "encryption";`);
  }
}
